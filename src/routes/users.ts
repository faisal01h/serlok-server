import { Elysia, t } from 'elysia'
import { authMiddleware } from '../middleware/auth'
import { db } from '../db'
import { users, deviceTokens } from '../db/schema'
import { eq } from 'drizzle-orm'

export const userRoutes = new Elysia({ prefix: '/users' })
  .use(authMiddleware)
  .get(
    '/me',
    ({ user }) => user,
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
