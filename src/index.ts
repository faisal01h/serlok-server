import { Elysia } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { jwt } from '@elysiajs/jwt'
import { cors } from '@elysiajs/cors'
import { eq } from 'drizzle-orm'
import { authRoutes } from './routes/auth'
import { userRoutes } from './routes/users'
import { friendRoutes } from './routes/friends'
import { locationRoutes } from './routes/locations'
import { reactionRoutes } from './routes/reactions'
import { statusRoutes } from './routes/status'
import { placeRoutes } from './routes/places'
import { websocketHandler } from './websocket/handler'
import { db } from './db'
import { runMigrations } from './db/migrate'
import { users } from './db/schema'
import { setServer } from './lib/pubsub'

const JWT_SECRET = Bun.env.JWT_SECRET ?? 'change-me-in-production'

// Sub-app that verifies JWT during the WS upgrade and populates ws.data.user
const wsApp = new Elysia()
  .use(jwt({ name: 'jwt', secret: JWT_SECRET }))
  .resolve({ as: 'scoped' }, async ({ jwt, headers }) => {
    const auth = headers['authorization']
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
    if (!token) return { user: undefined as typeof users.$inferSelect | undefined }
    const payload = await jwt.verify(token)
    if (!payload || !('sub' in payload) || !payload.sub) {
      return { user: undefined as typeof users.$inferSelect | undefined }
    }
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, payload.sub as string))
      .limit(1)
    return { user: user ?? undefined }
  })
  .ws('/ws', websocketHandler)

async function start() {
  await runMigrations()

  const app = new Elysia()
    .use(cors())
    .use(
      swagger({
        documentation: {
          info: { title: 'Zenly API', version: '1.0.0' },
          tags: [
            { name: 'Auth', description: 'Authentication & tokens' },
            { name: 'Users', description: 'User profile management' },
            { name: 'Friends', description: 'Social graph' },
            { name: 'Locations', description: 'Location updates & history' },
            { name: 'Reactions', description: 'Emoji reactions' },
            { name: 'Status', description: 'User statuses' },
            { name: 'Places', description: 'Saved places' },
          ],
        },
      }),
    )
    .use(
      jwt({
        name: 'jwt',
        secret: JWT_SECRET,
        exp: '15m',
      }),
    )
    .use(authRoutes)
    .use(userRoutes)
    .use(friendRoutes)
    .use(locationRoutes)
    .use(reactionRoutes)
    .use(statusRoutes)
    .use(placeRoutes)
    .use(wsApp)
    .listen(Bun.env.PORT ?? 3000)

  if (app.server) setServer(app.server)

  console.log(`🦊 Elysia running at ${app.server?.hostname}:${app.server?.port}`)
  console.log(`📖 Swagger UI at http://localhost:${app.server?.port}/swagger`)

  return app
}

const app = await start()

export type App = typeof app

