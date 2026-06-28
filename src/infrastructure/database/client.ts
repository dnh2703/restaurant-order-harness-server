import { drizzle } from 'drizzle-orm/node-postgres'
import { Client, Pool } from 'pg'

import { env } from '../config/env'
import * as schema from './schema'

/**
 * Single shared connection pool, created once at module scope and reused for every
 * request. node-postgres (`pg`) is the driver of record here because the realtime
 * broker (decision 0008) holds a persistent `LISTEN/NOTIFY` connection, which the
 * HTTP serverless driver cannot do. Point DATABASE_URL at Neon's pooled (-pooler)
 * host for app traffic.
 *
 * Tuned for Neon's serverless, scale-to-zero compute:
 * - `connectionTimeoutMillis` fails a cold/stuck connect fast (10s) instead of hanging on
 *   the OS TCP timeout (~75s), so a request errors promptly and the caller can retry.
 * - `keepAlive` keeps in-use sockets healthy across brief network stalls.
 * (`idleTimeoutMillis` is left at the pg default of 10s, which already retires idle
 * connections before Neon's pooler drops them.)
 */
export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
})

export const db = drizzle({ client: pool, schema, casing: 'snake_case' })

export type Database = typeof db

/**
 * A standalone, direct (non-pooled) connection for the realtime broker's LISTEN/NOTIFY.
 * PgBouncer transaction pooling (Neon's -pooler host used by DATABASE_URL) cannot hold a
 * LISTEN, so the broker connects to DATABASE_URL_UNPOOLED with its own single Client.
 * Same cold-start tuning rationale as the app pool.
 */
export function createListenerClient(connectionString: string): Client {
  return new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  })
}
