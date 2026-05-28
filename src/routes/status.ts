import { Elysia, t } from 'elysia'
import { authMiddleware } from '../middleware/auth'
import { db } from '../db'
import { statuses } from '../db/schema'
import { eq } from 'drizzle-orm'

export const statusRoutes = new Elysia({ prefix: '/status' })
  .use(authMiddleware)
  .put(
    '/',
    async ({ user, body }) => {
      const [status] = await db
        .insert(statuses)
        .values({
          userId: user.id,
          emoji: body.emoji ?? null,
          text: body.text ?? null,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: statuses.userId,
          set: {
            emoji: body.emoji ?? null,
            text: body.text ?? null,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
            updatedAt: new Date(),
          },
        })
        .returning()
      return status
    },
    {
      body: t.Object({
        emoji: t.Optional(t.String()),
        text: t.Optional(t.String({ maxLength: 60 })),
        expiresAt: t.Optional(t.String()),
      }),
      detail: { tags: ['Status'], summary: 'Set or update user status' },
    },
  )
  .delete(
    '/',
    async ({ user }) => {
      await db.delete(statuses).where(eq(statuses.userId, user.id))
      return new Response(null, { status: 204 })
    },
    { detail: { tags: ['Status'], summary: 'Clear user status' } },
  )
