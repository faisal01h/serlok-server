import { Elysia, t } from 'elysia'
import { authMiddleware } from '../middleware/auth'
import { db } from '../db'
import { locations } from '../db/schema'
import { redis } from '../lib/redis'
import { locationQueue } from '../lib/queue'
import { getFriendIds } from '../services/friends'
import { sql, and, eq, gte, lte } from 'drizzle-orm'

async function setGhostMode(userId: string, enabled: boolean) {
  await redis.set(`ghost:${userId}`, enabled ? '1' : '0', 'EX', 86400)
}

export { setGhostMode }

async function getLocationHistory(
  targetId: string,
  query: { from?: string; to?: string },
) {
  const conditions = [eq(locations.userId, targetId)]
  if (query.from) conditions.push(gte(locations.recordedAt, new Date(query.from)))
  if (query.to) conditions.push(lte(locations.recordedAt, new Date(query.to)))

  return db
    .select({
      id: locations.id,
      userId: locations.userId,
      lat: sql<number>`ST_Y(${locations.geom})`,
      lng: sql<number>`ST_X(${locations.geom})`,
      accuracy: locations.accuracy,
      speed: locations.speed,
      heading: locations.heading,
      battery: locations.battery,
      isGhost: locations.isGhost,
      recordedAt: locations.recordedAt,
    })
    .from(locations)
    .where(and(...conditions))
    .orderBy(sql`${locations.recordedAt} DESC`)
    .limit(500)
}

export const locationRoutes = new Elysia({ prefix: '/locations' })
  .use(authMiddleware)
  .post(
    '/',
    async ({ body, user }) => {
      await redis.set(
        `location:${user.id}`,
        JSON.stringify({ lat: body.lat, lng: body.lng, battery: body.battery }),
        'EX',
        3600,
      )
      await locationQueue.add('persist', { userId: user.id, ...body })
      return new Response(null, { status: 204 })
    },
    {
      body: t.Object({
        lat: t.Number(),
        lng: t.Number(),
        accuracy: t.Number(),
        speed: t.Optional(t.Number()),
        heading: t.Optional(t.Number()),
        battery: t.Number({ minimum: 0, maximum: 100 }),
      }),
      detail: { tags: ['Locations'], summary: 'Push a location update' },
    },
  )
  .post(
    '/ghost',
    async ({ body, user }) => {
      await setGhostMode(user.id, body.enabled)
      return new Response(null, { status: 204 })
    },
    {
      body: t.Object({ enabled: t.Boolean() }),
      detail: { tags: ['Locations'], summary: 'Toggle ghost mode' },
    },
  )
  .get(
    '/history',
    async ({ query, user, set }) => {
      const targetId = query.userId ?? user.id

      if (targetId !== user.id) {
        const friendIds = await getFriendIds(user.id)
        if (!friendIds.includes(targetId)) {
          set.status = 403
          throw new Error('Forbidden: not a friend')
        }
        const ghostRaw = await redis.get(`ghost:${targetId}`)
        if (ghostRaw === '1') {
          set.status = 403
          throw new Error('Forbidden: user is in ghost mode')
        }
      }

      return getLocationHistory(targetId, query)
    },
    {
      query: t.Object({
        userId: t.Optional(t.String()),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
      }),
      detail: { tags: ['Locations'], summary: 'Get location history' },
    },
  )
