import { and, eq, sql } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orders } from '../../infrastructure/database/schema'
import { loadOrder, type OrderView } from '../orders/get-order'
import { type DiscountInput, resolveDiscountAmount } from './discount'
import { throwOrderGateFailure } from './order-guard'

/**
 * Apply a discount to an OPEN order (US-5.3) and recompute its total. PERCENT is computed from the
 * order's current `subtotal`. The write is a tenant + `status='OPEN'` conditional UPDATE that also
 * re-floors `total = max(subtotal - discount, 0)`; a 0-row result disambiguates to
 * `404 ORDER_NOT_FOUND` / `409 ORDER_NOT_OPEN`. An out-of-range value throws `422 INVALID_DISCOUNT`
 * before any write.
 */
export async function applyDiscount(
  database: Database,
  restaurantId: string,
  orderId: string,
  input: DiscountInput,
): Promise<OrderView> {
  const [open] = await database
    .select({ subtotal: orders.subtotal })
    .from(orders)
    .where(
      and(eq(orders.id, orderId), eq(orders.restaurantId, restaurantId), eq(orders.status, 'OPEN')),
    )
    .limit(1)
  if (!open) await throwOrderGateFailure(database, restaurantId, orderId)

  const discountAmount = resolveDiscountAmount(open!.subtotal, input)

  const updated = await database
    .update(orders)
    .set({
      discountAmount,
      discountReason: input.reason ?? null,
      total: sql`GREATEST(${orders.subtotal} - ${discountAmount}, 0)`,
    })
    .where(
      and(eq(orders.id, orderId), eq(orders.restaurantId, restaurantId), eq(orders.status, 'OPEN')),
    )
    .returning({ id: orders.id })
  if (!updated[0]) await throwOrderGateFailure(database, restaurantId, orderId)

  return loadOrder(database, orderId)
}
