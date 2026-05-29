import { Elysia, t } from 'elysia'
import { authMiddleware } from '../middleware/auth'
import { db } from '../db'
import { users, deviceTokens, statuses } from '../db/schema'
import { eq, ilike, or, and, ne } from 'drizzle-orm'

export const userRoutes = new Elysia({ prefix: '/users' })
  .use(authMiddleware)
  .get(
    '/search',
    async ({ user, query, set }) => {
      const q = query.q.trim()
      if (q.length < 2) {
        set.status = 400
        throw new Error('Query must be at least 2 characters')
      }
      return db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(
          and(
            ne(users.id, user.id),
            or(ilike(users.username, `%${q}%`), eq(users.phone, q)),
          ),
        )
        .limit(20)
    },
    {
      query: t.Object({ q: t.String() }),
      detail: { tags: ['Users'], summary: 'Search users by username or phone number' },
    },
  )
  .get(
    '/me',
    async ({ user }) => {
      const [row] = await db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          phone: users.phone,
          avatarUrl: users.avatarUrl,
          createdAt: users.createdAt,
          status: {
            userId: statuses.userId,
            emoji: statuses.emoji,
            text: statuses.text,
            expiresAt: statuses.expiresAt,
          },
        })
        .from(users)
        .leftJoin(statuses, eq(statuses.userId, user.id))
        .where(eq(users.id, user.id))
        .limit(1)
      if (!row) throw new Error('User not found')
      // Replace status with null when no status row exists (left join produces all-null object)
      return { ...row, status: row.status.userId ? row.status : null }
    },
    { detail: { tags: ['Users'], summary: 'Get current user profile' } },
  )
  .patch(
    '/me',
    async ({ user, body }) => {
      const [updated] = await db
        .update(users)
        .set({
          ...(body.username !== undefined && { username: body.username }),
          ...(body.displayName !== undefined && { displayName: body.displayName }),
          ...(body.avatarUrl !== undefined && { avatarUrl: body.avatarUrl }),
        })
        .where(eq(users.id, user.id))
        .returning()
      return updated
    },
    {
      body: t.Object({
        username: t.Optional(t.String()),
        displayName: t.Optional(t.String()),
        avatarUrl: t.Optional(t.String()),
      }),
      detail: { tags: ['Users'], summary: 'Update current user profile' },
    },
  )
  .put(
    '/me/apns-token',
    async ({ user, body }) => {
      await db
        .insert(deviceTokens)
        .values({ userId: user.id, platform: 'apns', token: body.token })
        .onConflictDoUpdate({
          target: [deviceTokens.userId, deviceTokens.platform],
          set: { token: body.token, updatedAt: new Date() },
        })
      return new Response(null, { status: 204 })
    },
    {
      body: t.Object({ token: t.String() }),
      detail: { tags: ['Users'], summary: 'Register APNs device token' },
    },
  )
  .put(
    '/me/fcm-token',
    async ({ user, body }) => {
      await db
        .insert(deviceTokens)
        .values({ userId: user.id, platform: 'fcm', token: body.token })
        .onConflictDoUpdate({
          target: [deviceTokens.userId, deviceTokens.platform],
          set: { token: body.token, updatedAt: new Date() },
        })
      return new Response(null, { status: 204 })
    },
    {
      body: t.Object({ token: t.String() }),
      detail: { tags: ['Users'], summary: 'Register FCM device token' },
    },
  )
  .delete(
    '/me',
    async ({ user }) => {
      await db.delete(users).where(eq(users.id, user.id))
      return new Response(null, { status: 204 })
    },
    { detail: { tags: ['Users'], summary: 'Delete account and all associated data' } },
  )
