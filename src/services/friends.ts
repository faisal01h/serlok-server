import { db } from '../db'
import { friendships } from '../db/schema'
import { redis } from '../lib/redis'
import { or, and, eq } from 'drizzle-orm'

const FRIEND_CACHE_TTL = 300 // 5 minutes

export async function getFriendIds(userId: string): Promise<string[]> {
  const cacheKey = `friends:${userId}`
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached)

  const rows = await db
    .select()
    .from(friendships)
    .where(
      and(
        or(eq(friendships.requesterId, userId), eq(friendships.recipientId, userId)),
        eq(friendships.status, 'accepted'),
      ),
    )

  const ids = rows.map((r) =>
    r.requesterId === userId ? r.recipientId : r.requesterId,
  )
  await redis.set(cacheKey, JSON.stringify(ids), 'EX', FRIEND_CACHE_TTL)
  return ids
}
