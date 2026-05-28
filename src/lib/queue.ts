import { Queue, Worker } from 'bullmq'
import { db } from '../db'
import { locations } from '../db/schema'
import { sql } from 'drizzle-orm'

function parseBullMQConnection(redisUrl: string) {
  const u = new URL(redisUrl)
  return {
    host: u.hostname || 'localhost',
    port: u.port ? parseInt(u.port, 10) : 6379,
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.pathname && u.pathname !== '/' ? { db: parseInt(u.pathname.slice(1), 10) } : {}),
  }
}

const connection = parseBullMQConnection(Bun.env.REDIS_URL ?? 'redis://localhost:6379')

// ─── Location persist queue ───────────────────────────────────────────────────

export const locationQueue = new Queue('locations', { connection })

new Worker(
  'locations',
  async (job) => {
    const { userId, lat, lng, accuracy, speed, heading, battery, isGhost } = job.data
    await db.insert(locations).values({
      userId,
      geom: sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`,
      accuracy,
      speed: speed ?? null,
      heading: heading ?? null,
      battery: battery ?? null,
      isGhost: isGhost ?? false,
      recordedAt: new Date(),
    })
  },
  { connection },
)
