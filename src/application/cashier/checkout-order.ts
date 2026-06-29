import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orders, payments, tables } from '../../infrastructure/database/schema'
import { loadOrder, type OrderView } from '../orders/get-order'
import { throwOrderGateFailure } from './order-guard'

export type PaymentMethod = 'CASH' | 'TRANSFER' | 'CARD'

export interface CheckoutResult {
  payment: { id: string; method: PaymentMethod; amount: number; paidAt: string }
  order: OrderView
}

/**
 * Finalize payment and close a table session (US-5.4). Money-critical:
 *
 *  1. GATE — `UPDATE orders SET status='PAID', closed_at=now() WHERE id AND restaurant_id AND
 *     status='OPEN' RETURNING { tableId, total }`. Exactly one concurrent request can flip
 *     OPEN→PAID; it gets the row (and the authoritative `total`). 0 rows → `throwOrderGateFailure`
 *     (`404 ORDER_NOT_FOUND` / `409 ORDER_NOT_OPEN`). This gate is the double-charge guard.
 *  2. RECORD — insert a `payments` row with `amount = total` (server-authoritative) and
 *     `cashier_id = cashierId`.
 *  3. FREE — `UPDATE tables SET status='EMPTY'` (idempotent; re-converges OCCUPIED-iff-OPEN).
 *
 * No item-status gate (any PENDING/COOKING item is still billed; CANCELLED already excluded from
 * the total). Autocommit statements (no multi-statement transaction). Accepted trade-off: a crash
 * between steps 1 and 2 leaves a PAID order with no payment row (lost audit, never a double charge).
 */
export async function checkoutOrder(
  database: Database,
  restaurantId: string,
  orderId: string,
  input: { method: PaymentMethod },
  cashierId: string,
): Promise<CheckoutResult> {
  const claimed = await database
    .update(orders)
    .set({ status: 'PAID', closedAt: new Date() })
    .where(
      and(eq(orders.id, orderId), eq(orders.restaurantId, restaurantId), eq(orders.status, 'OPEN')),
    )
    .returning({ tableId: orders.tableId, total: orders.total })
  if (!claimed[0]) await throwOrderGateFailure(database, restaurantId, orderId)
  const { tableId, total } = claimed[0]!

  const [payment] = await database
    .insert(payments)
    .values({ orderId, method: input.method, amount: total, cashierId })
    .returning({
      id: payments.id,
      method: payments.method,
      amount: payments.amount,
      paidAt: payments.paidAt,
    })

  await database.update(tables).set({ status: 'EMPTY' }).where(eq(tables.id, tableId))

  return {
    payment: {
      id: payment!.id,
      method: payment!.method,
      amount: payment!.amount,
      paidAt: payment!.paidAt.toISOString(),
    },
    order: await loadOrder(database, orderId),
  }
}
