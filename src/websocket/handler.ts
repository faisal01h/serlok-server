import type { ElysiaWS } from 'elysia/ws'
import { redis } from '../lib/redis'
import { locationQueue } from '../lib/queue'
import { getFriendIds } from '../services/friends'

const rooms = new Map<string, Set<ElysiaWS>>()

export const websocketHandler = {
  open(ws: ElysiaWS) {
    const userId = (ws.data as any).user?.id
    if (!userId) return ws.close(4001, 'Unauthorized')
    if (!rooms.has(userId)) rooms.set(userId, new Set())
    rooms.get(userId)!.add(ws)
    ws.subscribe(`user:${userId}`)
  },

  async message(ws: ElysiaWS, raw: unknown) {
    let msg: Record<string, unknown>
    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>)
    } catch {
      return
    }

    const userId = (ws.data as any).user?.id
    if (!userId) return

    if (msg.type === 'location:push') {
      const { lat, lng, accuracy, speed, heading, battery } = msg as {
        lat: number
        lng: number
        accuracy: number
        speed?: number
        heading?: number
        battery: number
      }

      const ghostRaw = await redis.get(`ghost:${userId}`)
      const isGhost = ghostRaw === '1'

      await redis.set(
        `location:${userId}`,
        JSON.stringify({ lat, lng, battery }),
        'EX',
        3600,
      )

      await locationQueue.add('persist', {
        userId,
        lat,
        lng,
        accuracy,
        speed,
        heading,
        battery,
        isGhost,
      })

      if (!isGhost) {
        const friends = await getFriendIds(userId)
        const payload = JSON.stringify({
          type: 'location:update',
          userId,
          lat,
          lng,
          accuracy,
          speed,
          heading,
          battery,
          timestamp: new Date().toISOString(),
        })
        for (const friendId of friends) {
          ws.publish(`user:${friendId}`, payload)
        }
      }
    }

    if (msg.type === 'subscribe') {
      // Only allow subscribing to channels of accepted friends
      const friendIds = await getFriendIds(userId)
      const friendSet = new Set(friendIds)
      for (const uid of (msg.userIds as string[]) ?? []) {
        if (friendSet.has(uid)) ws.subscribe(`user:${uid}`)
      }
    }

    if (msg.type === 'unsubscribe') {
      for (const uid of (msg.userIds as string[]) ?? []) {
        ws.unsubscribe(`user:${uid}`)
      }
    }
  },

  close(ws: ElysiaWS) {
    const userId = (ws.data as any).user?.id
    if (userId) rooms.get(userId)?.delete(ws)
  },
}
