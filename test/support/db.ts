import { Pool } from 'pg'

import { env } from '../../src/infrastructure/config/env'

/**
 * Shared helpers for the DB-backed integration suites. They require a migrated
 * DATABASE_URL (a Neon branch); when the DB is unreachable or unmigrated the suites
 * self-skip so a plain `bun test` stays green.
 *
 * Neon scale-to-zero makes the first connection after idle slow enough to blow past
 * Bun's default 5s test timeout, so each integration test opts into a generous timeout
 * and the suites warm the compute once in `beforeAll`.
 */

/** Generous per-test timeout that absorbs a single Neon cold start. */
export const DB_TIMEOUT_MS = 30_000

/** beforeAll budget for waking a scaled-to-zero compute before the timed tests run. */
export const WARMUP_TIMEOUT_MS = 90_000

/**
 * Only a slow/cold connect is worth retrying: Neon scale-to-zero surfaces as a connection
 * timeout (or a transient reset) while the compute wakes. Anything else — nothing
 * listening (ECONNREFUSED, e.g. CI's dummy localhost URL), an unresolvable host
 * (ENOTFOUND), or a migrated-but-missing table (42P01) — won't change by retrying, so we
 * stop immediately instead of busy-looping the whole budget.
 */
function isWakingUp(error: unknown): boolean {
  const e = error as { code?: string; message?: string }
  if (e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET') return true
  return typeof e.message === 'string' && e.message.includes('connection timeout')
}

/**
 * Wake a scaled-to-zero Neon compute and confirm the schema is migrated. The shared app
 * pool can hang on a cold-start connect, so probe with a short-lived, fast-failing pool
 * and retry only while the compute is waking. Returns false (self-skip) the moment the DB
 * is definitively unavailable or unmigrated. Waking the compute here also keeps the shared
 * `db` pool's later connects fast.
 */
export async function probeMigratedDb(): Promise<boolean> {
  const deadline = Date.now() + WARMUP_TIMEOUT_MS - 5_000
  while (Date.now() < deadline) {
    const probe = new Pool({
      connectionString: env.databaseUrl,
      connectionTimeoutMillis: 10_000,
      max: 1,
    })
    try {
      await probe.query('select 1 from orders limit 0')
      return true
    } catch (error) {
      if (!isWakingUp(error)) return false
      await Bun.sleep(1_000) // brief backoff before the next wake attempt
    } finally {
      await probe.end().catch(() => {})
    }
  }
  return false
}
