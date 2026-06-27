import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'

import { db } from '../src/infrastructure/database/client'
import { orders, restaurants, tables } from '../src/infrastructure/database/schema'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from './support/db'

/**
 * Integration proof for the core data-model invariant (US-002): at most one OPEN order
 * per table, enforced by the partial unique index `orders_one_open_per_table_idx`.
 *
 * Requires a migrated DATABASE_URL (a Neon branch); self-skips otherwise (see ./support/db).
 *
 * Each test tracks the ids it creates and deletes them in afterEach, so a passing run
 * leaves the branch as it found it.
 */
/** Drizzle wraps driver errors; the pg error (with its SQLSTATE `code`) is the cause. */
function pgErrorCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } }
  return e.code ?? e.cause?.code
}

let schemaAvailable = false

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
}, WARMUP_TIMEOUT_MS)

const createdRestaurantIds: string[] = []

async function makeTable(): Promise<{ restaurantId: string; tableId: string }> {
  const [restaurant] = await db
    .insert(restaurants)
    .values({ name: 'Invariant Test Co' })
    .returning({ id: restaurants.id })
  createdRestaurantIds.push(restaurant!.id)
  const [table] = await db
    .insert(tables)
    .values({ restaurantId: restaurant!.id, name: 'T1', qrToken: `test-${randomUUID()}` })
    .returning({ id: tables.id })
  return { restaurantId: restaurant!.id, tableId: table!.id }
}

afterEach(async () => {
  // Cascade from restaurants is not configured (history is protected), so unwind by hand:
  // orders → tables → restaurants. order_items cascade from orders, but this suite makes none.
  for (const restaurantId of createdRestaurantIds.splice(0)) {
    await db.delete(orders).where(eq(orders.restaurantId, restaurantId))
    await db.delete(tables).where(eq(tables.restaurantId, restaurantId))
    await db.delete(restaurants).where(eq(restaurants.id, restaurantId))
  }
}, DB_TIMEOUT_MS)

describe('orders: one OPEN order per table', () => {
  it(
    'rejects a second OPEN order for the same table with a unique violation',
    async () => {
      if (!schemaAvailable) return

      const { restaurantId, tableId } = await makeTable()
      await db.insert(orders).values({ restaurantId, tableId }) // first OPEN — allowed

      let secondInsertCode: string | undefined
      try {
        await db.insert(orders).values({ restaurantId, tableId }) // second OPEN — must reject
      } catch (error) {
        secondInsertCode = pgErrorCode(error)
      }

      expect(secondInsertCode).toBe('23505') // unique_violation
    },
    DB_TIMEOUT_MS,
  )

  it(
    'allows a new OPEN order once the prior one is no longer OPEN',
    async () => {
      if (!schemaAvailable) return

      const { restaurantId, tableId } = await makeTable()
      // First order is PAID, so it falls outside the partial index predicate.
      await db.insert(orders).values({ restaurantId, tableId, status: 'PAID' })

      let secondInsertSucceeded = false
      await db.insert(orders).values({ restaurantId, tableId })
      secondInsertSucceeded = true

      expect(secondInsertSucceeded).toBe(true)
    },
    DB_TIMEOUT_MS,
  )
})
