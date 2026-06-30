import { and, eq, exists, sql } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orderItems, orders } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { assertTransition, type KitchenStatus, requiredPredecessor } from './item-status'

/**
 * Advance one order item's status (US-011 / SPEC US-4.2). Forward-only PENDING→COOKING→SERVED.
 *
 * Tenancy + transition + concurrency are enforced in a single conditional UPDATE: we update the
 * row only when it belongs to `restaurantId` (its order's restaurant) AND currently holds the
 * legal predecessor status. `RETURNING` tells us which case we hit:
 *   - 1 row  → advanced; the status trigger fires NOTIFY for the customer + staff streams.
 *   - 0 rows → either the item is absent / cross-tenant, or its status was not the predecessor.
 *     We disambiguate with one follow-up existence check so the caller gets NOT_FOUND vs
 *     INVALID_TRANSITION. Doing the precondition in SQL (not read-then-write) means two cooks
 *     racing the same item resolve deterministically — one updates, the other gets 0 rows.
 */
export async function advanceItemStatus(
  database: Database,
  restaurantId: string,
  orderItemId: string,
  to: KitchenStatus,
): Promise<{ id: string; status: KitchenStatus }> {
  const inRestaurant = exists(
    database
      .select({ one: orders.id })
      .from(orders)
      .where(and(eq(orders.id, orderItems.orderId), eq(orders.restaurantId, restaurantId))),
  )

  const updated = await database
    .update(orderItems)
    // Stamp serve time only on the →SERVED step; earlier transitions leave served_at null.
    .set(to === 'SERVED' ? { status: to, servedAt: sql`now()` } : { status: to })
    .where(
      and(
        eq(orderItems.id, orderItemId),
        eq(orderItems.status, requiredPredecessor(to)),
        inRestaurant,
      ),
    )
    .returning({ id: orderItems.id })

  if (updated[0]) return { id: updated[0].id, status: to }

  // 0 rows updated — find out why. Read the item's current status within the tenant.
  const [current] = await database
    .select({ status: orderItems.status })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orderItems.id, orderItemId), eq(orders.restaurantId, restaurantId)))
    .limit(1)

  if (!current) throw new AppError('NOT_FOUND')
  assertTransition(current.status, to) // throws INVALID_TRANSITION (current ≠ predecessor)
  // Defensive: predecessor matched but the UPDATE still found 0 rows (a concurrent advance won).
  throw new AppError('INVALID_TRANSITION', { details: { raced: true } })
}
