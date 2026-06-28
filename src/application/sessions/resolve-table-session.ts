import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orders, restaurants, tables } from '../../infrastructure/database/schema'
import { AppError, pgErrorCode } from '../../shared/errors'

/**
 * Customer session header returned when a QR code resolves to a table (US-005).
 * Shapes exactly what the customer screen needs to confirm the guest is at the right
 * table: restaurant name, table name/number, and the OPEN order (session) details.
 */
export interface TableSession {
  restaurant: { name: string }
  table: { id: string; name: string; status: 'EMPTY' | 'OCCUPIED' }
  session: { orderId: string; status: 'OPEN'; openedAt: string }
}

async function findOpenOrder(database: Database, tableId: string) {
  const [order] = await database
    .select({ id: orders.id, openedAt: orders.openedAt })
    .from(orders)
    .where(and(eq(orders.tableId, tableId), eq(orders.status, 'OPEN')))
    .limit(1)
  return order
}

/**
 * Resolve a `qrToken` to its table and reuse-or-create the table's single OPEN order
 * (the table session). Implements SPEC US-1.1 / US-1.2:
 *
 * - Unknown/regenerated token → `AppError('INVALID_TABLE')` (404).
 * - Reuse the existing OPEN order when present; otherwise create one and mark the table
 *   OCCUPIED (invariant: a table is OCCUPIED iff it has an OPEN order).
 * - Concurrency: the partial unique index `orders(table_id) WHERE status='OPEN'` makes a
 *   racing create fail with a unique violation (23505); on conflict we re-read the
 *   winner's order rather than erroring.
 *
 * Each statement runs in autocommit (no multi-statement transaction). DATABASE_URL points
 * at Neon's pooled, transaction-mode endpoint, where holding the unique-index lock across
 * an insert + update + commit serializes concurrent scans badly; single statements keep
 * the lock window to one autocommit insert. The table is marked OCCUPIED with a separate
 * idempotent update, so the OCCUPIED-iff-OPEN invariant re-converges on the next scan even
 * if a process dies between the two writes.
 */
export async function resolveTableSession(
  database: Database,
  qrToken: string,
): Promise<TableSession> {
  const [table] = await database
    .select({
      id: tables.id,
      name: tables.name,
      restaurantId: tables.restaurantId,
    })
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
        .returning({ id: orders.id, openedAt: orders.openedAt })
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

  // Idempotent: re-converges the OCCUPIED-iff-OPEN invariant whether we created the order
  // or reused one whose table somehow drifted to EMPTY.
  await database.update(tables).set({ status: 'OCCUPIED' }).where(eq(tables.id, table.id))

  const [restaurant] = await database
    .select({ name: restaurants.name })
    .from(restaurants)
    .where(eq(restaurants.id, table.restaurantId))
    .limit(1)

  return {
    restaurant: { name: restaurant!.name },
    table: { id: table.id, name: table.name, status: 'OCCUPIED' },
    session: {
      orderId: order.id,
      status: 'OPEN',
      openedAt: order.openedAt.toISOString(),
    },
  }
}
