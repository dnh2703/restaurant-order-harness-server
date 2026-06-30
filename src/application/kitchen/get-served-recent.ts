import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orderItemOptions, orderItems, orders, tables } from '../../infrastructure/database/schema'

/** One recently-served card (E07): same shape as a queue card but keyed on serve time. */
export interface ServedRecentItem {
  id: string
  tableName: string
  nameSnapshot: string
  quantity: number
  note: string | null
  status: 'SERVED'
  servedAt: string
  options: { optionName: string; priceDelta: number }[]
}

/** The most recently-served cards returned in one call. */
const LIMIT = 50

/**
 * The kitchen "recently served" list: SERVED items across the restaurant's orders whose serve
 * time falls within the last 30 minutes, newest first, capped at {@link LIMIT} (backed by
 * index order_items_served_recent_idx). Mirrors
 * getKitchenQueue — two explicit-column reads (items joined to their table + order, then their
 * option snapshots) stitched in memory, no N+1, no SELECT *. Tenancy comes from the caller's
 * auth.restaurantId via the orders join. The served_at >= now() - interval predicate also
 * excludes legacy SERVED rows with a null served_at.
 */
export async function getServedRecent(
  database: Database,
  restaurantId: string,
): Promise<ServedRecentItem[]> {
  const rows = await database
    .select({
      id: orderItems.id,
      tableName: tables.name,
      nameSnapshot: orderItems.nameSnapshot,
      quantity: orderItems.quantity,
      note: orderItems.note,
      servedAt: orderItems.servedAt,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(tables, eq(tables.id, orders.tableId))
    .where(
      and(
        eq(orders.restaurantId, restaurantId),
        eq(orderItems.status, 'SERVED'),
        gte(orderItems.servedAt, sql`now() - interval '30 minutes'`),
      ),
    )
    .orderBy(desc(orderItems.servedAt), orderItems.id)
    .limit(LIMIT)

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

  const optionsByItem = new Map<string, ServedRecentItem['options']>()
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
    status: 'SERVED' as const,
    // The served_at >= ... predicate guarantees a non-null serve time here.
    servedAt: r.servedAt!.toISOString(),
    options: optionsByItem.get(r.id) ?? [],
  }))
}
