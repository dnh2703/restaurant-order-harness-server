import { and, eq, sql } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orders, payments } from '../../infrastructure/database/schema'
import { APP_TZ, type ReportRange } from './date-range'

/** One local day's revenue. */
export interface RevenueDay {
  day: string
  revenue: number
  orderCount: number
}

/** Sparse daily revenue series plus a full-range summary. */
export interface RevenueReport {
  days: RevenueDay[]
  summary: { from: string; to: string; totalRevenue: number; totalOrders: number }
}

/**
 * Daily revenue (sum of payments.amount) for a restaurant over an inclusive local-date range.
 * Sparse — only days with a payment appear. One grouped aggregation (payments ⋈ orders); the
 * summary is folded from the rows in app code. Tenant scope is the orders join.
 */
export async function getRevenueByDay(
  database: Database,
  restaurantId: string,
  range: ReportRange,
): Promise<RevenueReport> {
  const localDay = sql`(${payments.paidAt} AT TIME ZONE ${APP_TZ})::date`

  const rows = await database
    .select({
      day: sql<string>`to_char(${localDay}, 'YYYY-MM-DD')`,
      revenue: sql<number>`COALESCE(SUM(${payments.amount}), 0)`,
      orderCount: sql<number>`COUNT(*)`,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(
      and(
        eq(orders.restaurantId, restaurantId),
        sql`${localDay} BETWEEN ${range.from}::date AND ${range.to}::date`,
      ),
    )
    // Positional alias: Drizzle re-parameterizes a reused sql fragment, so grouping by the day expression directly trips Postgres 42803 — GROUP BY the first select column (the day) instead.
    .groupBy(sql`1`)
    .orderBy(sql`1`)

  const days = rows.map((r) => ({
    day: r.day,
    revenue: Number(r.revenue),
    orderCount: Number(r.orderCount),
  }))
  const totalRevenue = days.reduce((sum, d) => sum + d.revenue, 0)
  const totalOrders = days.reduce((sum, d) => sum + d.orderCount, 0)
  return { days, summary: { from: range.from, to: range.to, totalRevenue, totalOrders } }
}
