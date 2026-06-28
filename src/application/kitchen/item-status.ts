import { AppError } from '../../shared/errors'

/** Every value `order_item.status` can hold (mirrors the DB enum). */
export type OrderItemStatus = 'PENDING' | 'COOKING' | 'SERVED' | 'CANCELLED'

/** The statuses the kitchen may transition an item *to* (US-4.2). */
export type KitchenStatus = 'COOKING' | 'SERVED'

/**
 * Forward-only kitchen lifecycle (SPEC US-4.2 / docs/product/kitchen.md): each item advances
 * PENDING → COOKING → SERVED and never moves backward or skips. Cancellation is out of E07's
 * scope. The single legal predecessor of each target is the source of truth for both this guard
 * and the conditional UPDATE in advance-item-status (one `WHERE status = predecessor`).
 */
const PREDECESSOR: Record<KitchenStatus, OrderItemStatus> = {
  COOKING: 'PENDING',
  SERVED: 'COOKING',
}

/** The legal current status an item must hold to advance to `to`. */
export function requiredPredecessor(to: KitchenStatus): OrderItemStatus {
  return PREDECESSOR[to]
}

/** Throw `INVALID_TRANSITION` unless `from → to` is the one legal forward step. */
export function assertTransition(from: OrderItemStatus, to: KitchenStatus): void {
  if (PREDECESSOR[to] !== from) {
    throw new AppError('INVALID_TRANSITION', { details: { from, to } })
  }
}
