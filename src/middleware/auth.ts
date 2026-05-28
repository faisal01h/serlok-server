import { Elysia } from 'elysia'
import { jwt } from '@elysiajs/jwt'
import { db } from '../db'
import { users } from '../db/schema'
import { eq } from 'drizzle-orm'

export const authMiddleware = new Elysia({ name: 'auth-middleware' })
  .use(
    jwt({
      name: 'jwt',
      secret: Bun.env.JWT_SECRET!,
    }),
  )
  .derive({ as: 'scoped' }, async ({ jwt, headers, set }) => {
    const authorization = headers['authorization']
    if (!authorization?.startsWith('Bearer ')) {
      set.status = 401
      throw new Error('Missing or invalid Authorization header')
    }
    const token = authorization.slice(7)
    const payload = await jwt.verify(token)
    if (!payload || typeof payload.sub !== 'string') {
      set.status = 401
      throw new Error('Invalid or expired token')
    }
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1)
    if (!user) {
      set.status = 401
      throw new Error('User not found')
    }
    return { user }
  })
