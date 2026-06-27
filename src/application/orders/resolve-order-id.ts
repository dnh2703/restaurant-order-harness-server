import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orders, tables } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'

/**
 * Read-only: resolve a `qrToken` to its table's single OPEN order id (US-008 SSE stream).
 * Unlike `ensureOpenOrder`/`resolveTableSession`, this NEVER creates an order — opening a
 * stream must not mutate state. Unknown token, or a table with no OPEN order, → 404.
 */
export async function resolveOrderId(database: Database, qrToken: string): Promise<string> {
  const [row] = await database
    .select({ orderId: orders.id })
    .from(tables)
    .innerJoin(orders, and(eq(orders.tableId, tables.id), eq(orders.status, 'OPEN')))
    .where(eq(tables.qrToken, qrToken))
    .limit(1)

  if (!row) {
    throw new AppError('INVALID_TABLE')
  }
  return row.orderId
}
