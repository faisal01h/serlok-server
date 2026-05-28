import { Elysia, t } from 'elysia'
import { authMiddleware } from '../middleware/auth'
import { db } from '../db'
import { friendships } from '../db/schema'
import { eq, or, and } from 'drizzle-orm'

export const friendRoutes = new Elysia({ prefix: '/friends' })
  .use(authMiddleware)
  .get(
    '/',
    async ({ user }) => {
      return db
        .select()
        .from(friendships)
        .where(
          or(
            eq(friendships.requesterId, user.id),
            eq(friendships.recipientId, user.id),
          ),
        )
    },
    { detail: { tags: ['Friends'], summary: 'List all friendships' } },
  )
  .post(
    '/request',
    async ({ user, body, set }) => {
      const [existing] = await db
        .select()
        .from(friendships)
        .where(
          or(
            and(eq(friendships.requesterId, user.id), eq(friendships.recipientId, body.recipientId)),
            and(eq(friendships.requesterId, body.recipientId), eq(friendships.recipientId, user.id)),
          ),
        )
        .limit(1)
      if (existing) {
        set.status = 409
        throw new Error('Friendship already exists')
      }
      const [friendship] = await db
        .insert(friendships)
        .values({ requesterId: user.id, recipientId: body.recipientId, status: 'pending' })
        .returning()
      return friendship
    },
    {
      body: t.Object({ recipientId: t.String() }),
      detail: { tags: ['Friends'], summary: 'Send a friend request' },
    },
  )
  .patch(
    '/:id/accept',
    async ({ user, params, set }) => {
      const [friendship] = await db
        .select()
        .from(friendships)
        .where(and(eq(friendships.id, params.id), eq(friendships.recipientId, user.id)))
        .limit(1)
      if (!friendship) {
        set.status = 404
        throw new Error('Friendship not found')
      }
      const [updated] = await db
        .update(friendships)
        .set({ status: 'accepted' })
        .where(eq(friendships.id, params.id))
        .returning()
      return updated
    },
    { detail: { tags: ['Friends'], summary: 'Accept a friend request' } },
  )
  .delete(
    '/:id',
    async ({ user, params, set }) => {
      const [friendship] = await db
        .select()
        .from(friendships)
        .where(
          and(
            eq(friendships.id, params.id),
            or(eq(friendships.requesterId, user.id), eq(friendships.recipientId, user.id)),
          ),
        )
        .limit(1)
      if (!friendship) {
        set.status = 404
        throw new Error('Friendship not found')
      }
      await db.delete(friendships).where(eq(friendships.id, params.id))
      return new Response(null, { status: 204 })
    },
    { detail: { tags: ['Friends'], summary: 'Remove a friend or cancel a request' } },
  )
  .post(
    '/:id/block',
    async ({ user, params, set }) => {
      const [friendship] = await db
        .select()
        .from(friendships)
        .where(
          and(
            eq(friendships.id, params.id),
            or(eq(friendships.requesterId, user.id), eq(friendships.recipientId, user.id)),
          ),
        )
        .limit(1)
      if (!friendship) {
        set.status = 404
        throw new Error('Friendship not found')
      }
      await db
        .update(friendships)
        .set({ status: 'blocked' })
        .where(eq(friendships.id, params.id))
      return new Response(null, { status: 204 })
    },
    { detail: { tags: ['Friends'], summary: 'Block a user' } },
  )
