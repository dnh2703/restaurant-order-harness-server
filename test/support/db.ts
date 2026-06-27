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
 * Wake a scaled-to-zero Neon compute and confirm the schema is migrated. The shared app
 * pool has no connect timeout, so a single cold-start attempt can hang ~75s; instead retry
 * with a short-lived, fast-failing pool until one query lands. A "relation does not exist"
 * (42P01) is definitive — the DB is reachable but not migrated — so we stop and self-skip
 * rather than retry. Waking the compute here also keeps the shared `db` pool's later
 * connects fast.
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
      if ((error as { code?: string }).code === '42P01') return false // reachable, not migrated
      // connection/cold-start error — retry until the budget runs out
    } finally {
      await probe.end().catch(() => {})
    }
  }
  return false
}
