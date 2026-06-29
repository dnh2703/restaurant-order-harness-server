import { and, asc, eq, sql } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orderItems, orders, tables } from '../../infrastructure/database/schema'

/** One occupied table's open order with its running totals (US-5.1). */
export interface OpenTableView {
  orderId: string
  tableId: string
  tableName: string
  subtotal: number
  discountAmount: number
  total: number
  openedAt: string
  itemCount: number
}

/**
 * List a restaurant's OPEN orders (one per occupied table) with running totals, oldest session
 * first. `itemCount` is a correlated count of non-CANCELLED items (the billed lines). Tenancy is a
 * direct filter on `orders.restaurantId`; one explicit-column read joined to `tables`, no N+1.
 */
export async function listOpenTables(
  database: Database,
  restaurantId: string,
): Promise<OpenTableView[]> {
  const itemCount = sql<number>`(
    SELECT COUNT(*) FROM ${orderItems}
    WHERE ${orderItems.orderId} = ${orders.id} AND ${orderItems.status} <> 'CANCELLED'
  )`

  const rows = await database
    .select({
      orderId: orders.id,
      tableId: tables.id,
      tableName: tables.name,
      subtotal: orders.subtotal,
      discountAmount: orders.discountAmount,
      total: orders.total,
      openedAt: orders.openedAt,
      itemCount,
    })
    .from(orders)
    .innerJoin(tables, eq(tables.id, orders.tableId))
    .where(and(eq(orders.restaurantId, restaurantId), eq(orders.status, 'OPEN')))
    .orderBy(asc(orders.openedAt))

  return rows.map((r) => ({
    orderId: r.orderId,
    tableId: r.tableId,
    tableName: r.tableName,
    subtotal: r.subtotal,
    discountAmount: r.discountAmount,
    total: r.total,
    openedAt: r.openedAt.toISOString(),
    itemCount: Number(r.itemCount),
  }))
}
