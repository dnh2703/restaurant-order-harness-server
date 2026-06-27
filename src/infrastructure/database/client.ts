import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { env } from '../config/env'
import * as schema from './schema'

/**
 * Single shared connection pool, created once at module scope and reused for every
 * request. node-postgres (`pg`) is the driver of record here because the realtime
 * broker (decision 0008) holds a persistent `LISTEN/NOTIFY` connection, which the
 * HTTP serverless driver cannot do. Point DATABASE_URL at Neon's pooled (-pooler)
 * host for app traffic.
 */
export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
})

export const db = drizzle({ client: pool, schema, casing: 'snake_case' })

export type Database = typeof db
