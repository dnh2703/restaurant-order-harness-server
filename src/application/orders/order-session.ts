import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orders, tables } from '../../infrastructure/database/schema'
import { AppError, pgErrorCode } from '../../shared/errors'

/**
 * The table's current session: its single OPEN order plus the ids the ordering use-cases need
 * to scope their menu reads to the right restaurant.
 */
export interface OpenOrderContext {
  orderId: string
  tableId: string
  restaurantId: string
}

async function findOpenOrder(
  database: Database,
  tableId: string,
): Promise<{ id: string } | undefined> {
  const [order] = await database
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.tableId, tableId), eq(orders.status, 'OPEN')))
    .limit(1)
  return order
}

/**
 * Resolve a `qrToken` to its table and reuse-or-create the table's single OPEN order, mirroring
 * `resolveTableSession` (US-005) but returning just the ids the ordering use-cases need. Unknown
 * token → `AppError('INVALID_TABLE')` (404).
 *
 * Concurrency is handled exactly as in US-005: the partial unique index
 * `orders(table_id) WHERE status='OPEN'` makes a racing insert fail with `23505`, on which we
 * re-read the winner rather than erroring. Each statement runs in autocommit (no multi-statement
 * transaction) to keep the lock window to a single insert on Neon's transaction-mode pooler; the
 * OCCUPIED mark is a separate idempotent update that re-converges the OCCUPIED-iff-OPEN invariant.
 */
export async function ensureOpenOrder(
  database: Database,
  qrToken: string,
): Promise<OpenOrderContext> {
  const [table] = await database
    .select({ id: tables.id, restaurantId: tables.restaurantId })
    .from(tables)
    .where(eq(tables.qrToken, qrToken))
    .limit(1)

  if (!table) {
    throw new AppError('INVALID_TABLE')
  }

  let order = await findOpenOrder(database, table.id)

  if (!order) {
    try {
      const [created] = await database
        .insert(orders)
        .values({ restaurantId: table.restaurantId, tableId: table.id })
        .returning({ id: orders.id })
      order = created
    } catch (error) {
      // A concurrent scan won the race; the open order it created is the session.
      if (pgErrorCode(error) === '23505') {
        order = await findOpenOrder(database, table.id)
      } else {
        throw error
      }
    }
  }

  if (!order) {
    // Defensive: a conflict was seen but the winning order vanished before re-read.
    throw new AppError('INVALID_TABLE')
  }

  // Idempotent: re-converges the OCCUPIED-iff-OPEN invariant.
  await database.update(tables).set({ status: 'OCCUPIED' }).where(eq(tables.id, table.id))

  return { orderId: order.id, tableId: table.id, restaurantId: table.restaurantId }
}
