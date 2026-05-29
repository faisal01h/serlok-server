import { Elysia, t } from 'elysia'
import { authMiddleware } from '../middleware/auth'
import { db } from '../db'
import { reactions } from '../db/schema'
import { publishToUser } from '../lib/pubsub'

export const reactionRoutes = new Elysia({ prefix: '/reactions' })
  .use(authMiddleware)
  .post(
    '/',
    async ({ user, body }) => {
      const [reaction] = await db
        .insert(reactions)
        .values({ senderId: user.id, recipientId: body.recipientId, emoji: body.emoji })
        .returning()

      // Notify recipient via WebSocket
      publishToUser(body.recipientId, {
        type: 'reaction:received',
        senderId: user.id,
        emoji: body.emoji,
        sentAt: reaction.sentAt?.toISOString() ?? new Date().toISOString(),
      })

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
