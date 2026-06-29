import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orders } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { loadOrder, type OrderView } from '../orders/get-order'

/**
 * Full bill detail for one order (US-5.2). Tenant-scoped existence guard first — a missing or
 * cross-tenant id surfaces as `404 ORDER_NOT_FOUND` (existence never disclosed) — then reuse the
 * US-007 `loadOrder` read model (items, unit price, qty, option snapshots, discount, total). Works
 * for any order status (you can view a PAID bill).
 */
export async function getBill(
  database: Database,
  restaurantId: string,
  orderId: string,
): Promise<OrderView> {
  const [row] = await database
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.restaurantId, restaurantId)))
    .limit(1)
  if (!row) throw new AppError('ORDER_NOT_FOUND')
  return loadOrder(database, orderId)
}
