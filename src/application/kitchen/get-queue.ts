import { and, eq, inArray } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orderItemOptions, orderItems, orders, tables } from '../../infrastructure/database/schema'

/** One kitchen queue card (US-4.1). */
export interface QueueItem {
  id: string
  tableName: string
  nameSnapshot: string
  quantity: number
  note: string | null
  status: 'PENDING' | 'COOKING'
  createdAt: string
  options: { optionName: string; priceDelta: number }[]
}

/**
 * The kitchen make-queue (US-011 / SPEC US-4.1): all PENDING + COOKING items across the
 * restaurant's orders, oldest first (backed by index order_items_queue_idx). Two explicit-column
 * reads (items joined to their table + order, then their option snapshots) stitched in memory —
 * no N+1, no SELECT *. Tenancy comes from the caller's auth.restaurantId via the orders join.
 */
export async function getKitchenQueue(
  database: Database,
  restaurantId: string,
): Promise<QueueItem[]> {
  const rows = await database
    .select({
      id: orderItems.id,
      tableName: tables.name,
      nameSnapshot: orderItems.nameSnapshot,
      quantity: orderItems.quantity,
      note: orderItems.note,
      status: orderItems.status,
      createdAt: orderItems.createdAt,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(tables, eq(tables.id, orders.tableId))
    .where(
      and(
        eq(orders.restaurantId, restaurantId),
        inArray(orderItems.status, ['PENDING', 'COOKING']),
      ),
    )
    .orderBy(orderItems.createdAt, orderItems.id)

  const ids = rows.map((r) => r.id)
  const optionRows = ids.length
    ? await database
        .select({
          orderItemId: orderItemOptions.orderItemId,
          optionName: orderItemOptions.optionName,
          priceDelta: orderItemOptions.priceDelta,
        })
        .from(orderItemOptions)
        .where(inArray(orderItemOptions.orderItemId, ids))
    : []

  const optionsByItem = new Map<string, QueueItem['options']>()
  for (const o of optionRows) {
    const list = optionsByItem.get(o.orderItemId) ?? []
    list.push({ optionName: o.optionName, priceDelta: o.priceDelta })
    optionsByItem.set(o.orderItemId, list)
  }

  return rows.map((r) => ({
    id: r.id,
    tableName: r.tableName,
    nameSnapshot: r.nameSnapshot,
    quantity: r.quantity,
    note: r.note,
    status: r.status as 'PENDING' | 'COOKING',
    createdAt: r.createdAt.toISOString(),
    options: optionsByItem.get(r.id) ?? [],
  }))
}
