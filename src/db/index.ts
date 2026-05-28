import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema'

const connectionString = Bun.env.DATABASE_URL!

const client = postgres(connectionString)

export const db = drizzle(client, { schema })
