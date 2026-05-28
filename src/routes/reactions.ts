import { Elysia, t } from 'elysia'
import { authMiddleware } from '../middleware/auth'
import { db } from '../db'
import { reactions } from '../db/schema'

export const reactionRoutes = new Elysia({ prefix: '/reactions' })
  .use(authMiddleware)
  .post(
    '/',
    async ({ user, body }) => {
      const [reaction] = await db
        .insert(reactions)
        .values({ senderId: user.id, recipientId: body.recipientId, emoji: body.emoji })
        .returning()
      return reaction
    },
    {
      body: t.Object({
        recipientId: t.String(),
        emoji: t.String(),
      }),
      detail: { tags: ['Reactions'], summary: 'Send an emoji reaction to a friend' },
    },
  )
