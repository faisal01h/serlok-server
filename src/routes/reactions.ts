import { Elysia, t } from 'elysia'
import { authMiddleware } from '../middleware/auth'
import { db } from '../db'
import { reactions, users, deviceTokens } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { publishToUser } from '../lib/pubsub'
import { sendReactionPush } from '../lib/fcm'

export const reactionRoutes = new Elysia({ prefix: '/reactions' })
  .use(authMiddleware)
  .post(
    '/',
    async ({ user, body }) => {
      // Fetch sender display name and recipient FCM token in parallel
      const [senderRow, fcmRow, [reaction]] = await Promise.all([
        db
          .select({ displayName: users.displayName })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1),
        db
          .select({ token: deviceTokens.token })
          .from(deviceTokens)
          .where(and(eq(deviceTokens.userId, body.recipientId), eq(deviceTokens.platform, 'fcm')))
          .limit(1),
        db
          .insert(reactions)
          .values({ senderId: user.id, recipientId: body.recipientId, emoji: body.emoji })
          .returning(),
      ])

      const sentAt = reaction.sentAt?.toISOString() ?? new Date().toISOString()

      // Push WS event to recipient (works if they have the app open)
      publishToUser(body.recipientId, {
        type: 'reaction:received',
        senderId: user.id,
        emoji: body.emoji,
        sentAt,
      })

      // Send FCM push notification (works even if the app is closed)
      if (fcmRow[0]?.token) {
        const senderName = senderRow[0]?.displayName ?? 'Someone'
        sendReactionPush(fcmRow[0].token, senderName, body.emoji).catch(console.error)
      }

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
