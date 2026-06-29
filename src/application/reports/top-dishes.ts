import { and, desc, eq, sql } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orderItems, orders, payments } from '../../infrastructure/database/schema'
import { APP_TZ, type ReportRange } from './date-range'

/** One ranked dish over a date range. */
export interface TopDish {
  menuItemId: string
  name: string
  quantitySold: number
  revenue: number
}

/**
 * Dishes ranked by quantity sold (tiebreak revenue desc) from non-CANCELLED order_items of
 * PAID orders in an inclusive local-date range. Grouped by menu_item_id (stable identity across
 * renames); name is the latest name_snapshot.
 * revenue = Σ(quantity × unit_price) — option deltas excluded. One query.
 */
export async function getTopDishes(
  database: Database,
  restaurantId: string,
  range: ReportRange,
  limit: number,
): Promise<TopDish[]> {
  const quantitySold = sql<number>`SUM(${orderItems.quantity})`
  const revenue = sql<number>`SUM(${orderItems.quantity} * ${orderItems.unitPrice})`

  const rows = await database
    .select({
      menuItemId: orderItems.menuItemId,
      name: sql<string>`(array_agg(${orderItems.nameSnapshot} ORDER BY ${orderItems.createdAt} DESC))[1]`,
      quantitySold,
      revenue,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(payments, eq(payments.orderId, orders.id))
    .where(
      and(
        eq(orders.restaurantId, restaurantId),
        sql`${orderItems.status} <> 'CANCELLED'`,
        sql`(${payments.paidAt} AT TIME ZONE ${APP_TZ})::date BETWEEN ${range.from}::date AND ${range.to}::date`,
      ),
    )
    .groupBy(orderItems.menuItemId)
    .orderBy(desc(quantitySold), desc(revenue))
    .limit(limit)

  return rows.map((r) => ({
    menuItemId: r.menuItemId,
    name: r.name,
    quantitySold: Number(r.quantitySold),
    revenue: Number(r.revenue),
  }))
}
