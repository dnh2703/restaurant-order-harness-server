import { eq, inArray } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orderItemOptions, orderItems, orders } from '../../infrastructure/database/schema'
import { ensureOpenOrder } from './order-session'

/**
 * Read model for a customer's current order (US-007 `GET /api/qr/:qrToken/order`, the poll
 * surface for SPEC US-3.3). Returns the table's OPEN order with its items, each item's live
 * status, and the option snapshots taken at order time.
 */
export interface OrderItemOptionView {
  optionName: string
  priceDelta: number
}

export interface OrderItemView {
  id: string
  menuItemId: string
  nameSnapshot: string
  unitPrice: number
  quantity: number
  note: string | null
  status: 'PENDING' | 'COOKING' | 'SERVED' | 'CANCELLED'
  createdAt: string
  options: OrderItemOptionView[]
}

export interface OrderView {
  id: string
  status: 'OPEN' | 'PAID' | 'CANCELLED'
  subtotal: number
  discountAmount: number
  total: number
  openedAt: string
  items: OrderItemView[]
}

/**
 * Load `orderId`'s items (oldest first) with their option snapshots nested underneath, plus the
 * order header. Two explicit-column reads stitched in memory — no N+1, no `SELECT *`.
 */
export async function loadOrder(database: Database, orderId: string): Promise<OrderView> {
  const [order] = await database
    .select({
      id: orders.id,
      status: orders.status,
      subtotal: orders.subtotal,
      discountAmount: orders.discountAmount,
      total: orders.total,
      openedAt: orders.openedAt,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)

  const itemRows = await database
    .select({
      id: orderItems.id,
      menuItemId: orderItems.menuItemId,
      nameSnapshot: orderItems.nameSnapshot,
      unitPrice: orderItems.unitPrice,
      quantity: orderItems.quantity,
      note: orderItems.note,
      status: orderItems.status,
      createdAt: orderItems.createdAt,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(orderItems.createdAt, orderItems.id)

  const itemIds = itemRows.map((i) => i.id)
  const optionRows = itemIds.length
    ? await database
        .select({
          orderItemId: orderItemOptions.orderItemId,
          optionName: orderItemOptions.optionName,
          priceDelta: orderItemOptions.priceDelta,
        })
        .from(orderItemOptions)
        .where(inArray(orderItemOptions.orderItemId, itemIds))
    : []

  const optionsByItem = new Map<string, OrderItemOptionView[]>()
  for (const o of optionRows) {
    const list = optionsByItem.get(o.orderItemId) ?? []
    list.push({ optionName: o.optionName, priceDelta: o.priceDelta })
    optionsByItem.set(o.orderItemId, list)
  }

  return {
    id: order!.id,
    status: order!.status,
    subtotal: order!.subtotal,
    discountAmount: order!.discountAmount,
    total: order!.total,
    openedAt: order!.openedAt.toISOString(),
    items: itemRows.map((i) => ({
      id: i.id,
      menuItemId: i.menuItemId,
      nameSnapshot: i.nameSnapshot,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      note: i.note,
      status: i.status,
      createdAt: i.createdAt.toISOString(),
      options: optionsByItem.get(i.id) ?? [],
    })),
  }
}

/**
 * Resolve a `qrToken` to its table's current OPEN order and return it with items + statuses.
 * Like the QR-resolve route it reuses-or-opens the session order, so it always returns the
 * table's live order (creating an empty one only if the table has none yet); unknown token →
 * 404 INVALID_TABLE.
 */
export async function getOrderForQrToken(database: Database, qrToken: string): Promise<OrderView> {
  const { orderId } = await ensureOpenOrder(database, qrToken)
  return loadOrder(database, orderId)
}
