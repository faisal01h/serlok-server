import { Elysia, t } from 'elysia'
import { jwt } from '@elysiajs/jwt'
import { db } from '../db'
import { users, refreshTokens } from '../db/schema'
import { redis } from '../lib/redis'
import { eq } from 'drizzle-orm'

const OTP_TTL = 600 // 10 minutes

function generateOtp(): string {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return String(100000 + (buf[0]! % 900000))
}

function generateRequestId() {
  return crypto.randomUUID()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JwtInstance = { sign: (payload: any) => Promise<string> }

async function generateTokens(jwtInstance: JwtInstance, userId: string) {
  const accessToken = await jwtInstance.sign({
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + 15 * 60,
  })
  const refreshToken = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  await db.insert(refreshTokens).values({ userId, token: refreshToken, expiresAt })
  return { accessToken, refreshToken }
}

export const authRoutes = new Elysia({ prefix: '/auth' })
  .use(
    jwt({
      name: 'jwt',
      secret: Bun.env.JWT_SECRET!,
    }),
  )
  // ── Phone OTP ──────────────────────────────────────────────────────────────
  .post(
    '/phone/request-otp',
    async ({ body }) => {
      const requestId = generateRequestId()
      const otp = generateOtp()
      await redis.set(`otp:${requestId}`, JSON.stringify({ phone: body.phone, otp }), 'EX', OTP_TTL)
      // Only log in development — never in production
      if (Bun.env.BUN_ENV === 'development') {
        console.log(`[OTP dev] ${body.phone} → ${otp}`)
      }
      // TODO: send OTP via SMS provider (e.g. Twilio) in production
      return { requestId }
    },
    {
      body: t.Object({ phone: t.String() }),
      detail: { tags: ['Auth'], summary: 'Request a phone OTP' },
    },
  )
  .post(
    '/phone/verify-otp',
    async ({ body, jwt, set }) => {
      const raw = await redis.get(`otp:${body.requestId}`)
      if (!raw) {
        set.status = 400
        throw new Error('OTP expired or not found')
      }
      const { phone, otp } = JSON.parse(raw)
      if (otp !== body.otp) {
        set.status = 400
        throw new Error('Invalid OTP')
      }
      await redis.del(`otp:${body.requestId}`)

      let [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1)
      if (!user) {
        const [created] = await db
          .insert(users)
          .values({ phone, username: phone, displayName: phone })
          .returning()
        user = created
      }
      return generateTokens(jwt, user.id)
    },
    {
      body: t.Object({ requestId: t.String(), otp: t.String() }),
      detail: { tags: ['Auth'], summary: 'Verify phone OTP and receive tokens' },
    },
  )
  // ── Apple Sign-In ──────────────────────────────────────────────────────────
  .post(
    '/apple',
    async ({ body, jwt }) => {
      // In production, verify body.identityToken with Apple's public keys
      // and extract `sub` from the verified token rather than trusting the request body.
      const { sub } = body

      let [user] = await db.select().from(users).where(eq(users.appleSub, sub)).limit(1)
      if (!user) {
        const username = `apple_${sub.slice(0, 8)}_${Date.now()}`
        const [created] = await db
          .insert(users)
          .values({ appleSub: sub, username, displayName: body.displayName ?? 'Apple User' })
          .returning()
        user = created
      }
      return generateTokens(jwt, user.id)
    },
    {
      body: t.Object({
        sub: t.String(),
        identityToken: t.String(),
        displayName: t.Optional(t.String()),
      }),
      detail: { tags: ['Auth'], summary: 'Sign in with Apple' },
    },
  )
  // ── Google Sign-In ─────────────────────────────────────────────────────────
  .post(
    '/google',
    async ({ body, jwt }) => {
      // In production, verify body.idToken with Google's public keys
      // and extract `sub` from the verified token rather than trusting the request body.
      const { sub } = body

      let [user] = await db.select().from(users).where(eq(users.googleSub, sub)).limit(1)
      if (!user) {
        const username = `google_${sub.slice(0, 8)}_${Date.now()}`
        const [created] = await db
          .insert(users)
          .values({ googleSub: sub, username, displayName: body.displayName ?? 'Google User' })
          .returning()
        user = created
      }
      return generateTokens(jwt, user.id)
    },
    {
      body: t.Object({
        sub: t.String(),
        idToken: t.String(),
        displayName: t.Optional(t.String()),
      }),
      detail: { tags: ['Auth'], summary: 'Sign in with Google' },
    },
  )
  // ── Refresh token (full rotation: old deleted, new pair issued) ────────────
  .post(
    '/refresh',
    async ({ body, jwt, set }) => {
      const [row] = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.token, body.refreshToken))
        .limit(1)
      if (!row || row.expiresAt < new Date()) {
        set.status = 401
        throw new Error('Invalid or expired refresh token')
      }
      await db.delete(refreshTokens).where(eq(refreshTokens.token, body.refreshToken))
      // Return a rotated pair: new access token + new refresh token
      return generateTokens(jwt, row.userId)
    },
    {
      body: t.Object({ refreshToken: t.String() }),
      detail: { tags: ['Auth'], summary: 'Refresh access token (rotates refresh token)' },
    },
  )
