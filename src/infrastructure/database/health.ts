import { sql } from 'drizzle-orm'

import { db } from './client'

/**
 * Liveness probe for the database. Resolves when a trivial query round-trips,
 * throws otherwise. Used by GET /api/health.
 */
export async function checkDatabase(): Promise<void> {
  await db.execute(sql`select 1`)
}
