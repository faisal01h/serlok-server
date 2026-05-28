import { Elysia, t } from 'elysia'
import { authMiddleware } from '../middleware/auth'
import { db } from '../db'
import { places } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { sql } from 'drizzle-orm'

export const placeRoutes = new Elysia({ prefix: '/places' })
  .use(authMiddleware)
  .get(
    '/',
    async ({ user }) => {
      return db
        .select({
          id: places.id,
          userId: places.userId,
          label: places.label,
          lat: sql<number>`ST_Y(${places.geom})`,
          lng: sql<number>`ST_X(${places.geom})`,
          radiusM: places.radiusM,
          createdAt: places.createdAt,
        })
        .from(places)
        .where(eq(places.userId, user.id))
    },
    { detail: { tags: ['Places'], summary: 'List saved places' } },
  )
  .post(
    '/',
    async ({ user, body }) => {
      const [place] = await db
        .insert(places)
        .values({
          userId: user.id,
          label: body.label,
          geom: sql`ST_SetSRID(ST_MakePoint(${body.lng}, ${body.lat}), 4326)`,
          radiusM: body.radiusM ?? 100,
        })
        .returning()
      return place
    },
    {
      body: t.Object({
        label: t.String(),
        lat: t.Number(),
        lng: t.Number(),
        radiusM: t.Optional(t.Number({ minimum: 1 })),
      }),
      detail: { tags: ['Places'], summary: 'Create a new saved place' },
    },
  )
  .patch(
    '/:id',
    async ({ user, params, body, set }) => {
      const [existing] = await db
        .select()
        .from(places)
        .where(and(eq(places.id, params.id), eq(places.userId, user.id)))
        .limit(1)
      if (!existing) {
        set.status = 404
        throw new Error('Place not found')
      }
      const updateData: Record<string, unknown> = {}
      if (body.label !== undefined) updateData.label = body.label
      if (body.radiusM !== undefined) updateData.radiusM = body.radiusM
      if (body.lat !== undefined && body.lng !== undefined) {
        updateData.geom = sql`ST_SetSRID(ST_MakePoint(${body.lng}, ${body.lat}), 4326)`
      }
      const [updated] = await db
        .update(places)
        .set(updateData)
        .where(eq(places.id, params.id))
        .returning()
      return updated
    },
    {
      body: t.Object({
        label: t.Optional(t.String()),
        lat: t.Optional(t.Number()),
        lng: t.Optional(t.Number()),
        radiusM: t.Optional(t.Number({ minimum: 1 })),
      }),
      detail: { tags: ['Places'], summary: 'Update a saved place' },
    },
  )
  .delete(
    '/:id',
    async ({ user, params, set }) => {
      const [existing] = await db
        .select()
        .from(places)
        .where(and(eq(places.id, params.id), eq(places.userId, user.id)))
        .limit(1)
      if (!existing) {
        set.status = 404
        throw new Error('Place not found')
      }
      await db.delete(places).where(eq(places.id, params.id))
      return new Response(null, { status: 204 })
    },
    { detail: { tags: ['Places'], summary: 'Delete a saved place' } },
  )
