import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  doublePrecision,
  uniqueIndex,
  check,
  customType,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// PostGIS geometry point stored as text (WKT); raw SQL for writes, string for reads
const geometry = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geometry(Point, 4326)'
  },
})

// ─── users ────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').unique().notNull(),
  displayName: text('display_name').notNull(),
  phone: text('phone').unique(),
  avatarUrl: text('avatar_url'),
  appleSub: text('apple_sub').unique(),
  googleSub: text('google_sub').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// ─── friendships ─────────────────────────────────────────────────────────────

export const friendships = pgTable(
  'friendships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'), // pending | accepted | blocked
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    uniquePair: uniqueIndex('friendships_unique_pair').on(
      table.requesterId,
      table.recipientId,
    ),
  }),
)

// ─── locations ────────────────────────────────────────────────────────────────

export const locations = pgTable('locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  geom: geometry('geom').notNull(),
  accuracy: doublePrecision('accuracy'),
  speed: doublePrecision('speed'),
  heading: doublePrecision('heading'),
  battery: integer('battery'),
  isGhost: boolean('is_ghost').default(false),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// ─── places ───────────────────────────────────────────────────────────────────

export const places = pgTable('places', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  geom: geometry('geom').notNull(),
  radiusM: integer('radius_m').notNull().default(100),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// ─── reactions ────────────────────────────────────────────────────────────────

export const reactions = pgTable('reactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  senderId: uuid('sender_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  recipientId: uuid('recipient_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  emoji: text('emoji').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow(),
})

// ─── statuses ─────────────────────────────────────────────────────────────────

export const statuses = pgTable('statuses', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  emoji: text('emoji'),
  text: text('text'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

// ─── device_tokens ────────────────────────────────────────────────────────────

export const deviceTokens = pgTable(
  'device_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(), // 'apns' | 'fcm'
    token: text('token').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    uniqueUserPlatform: uniqueIndex('device_tokens_user_platform').on(
      table.userId,
      table.platform,
    ),
  }),
)

// ─── refresh_tokens ───────────────────────────────────────────────────────────

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').unique().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
