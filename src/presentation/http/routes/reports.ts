import { Elysia, t } from 'elysia'

import { parseReportRange } from '../../../application/reports/date-range'
import { getRevenueByDay } from '../../../application/reports/revenue-by-day'
import { getTopDishes } from '../../../application/reports/top-dishes'
import { db } from '../../../infrastructure/database/client'
import { authGuard } from '../plugins/auth-guard'

const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$'

/**
 * Reports API (E10 / SPEC EPIC 7). Every route is guarded `['ADMIN']` and tenant-scoped: the
 * restaurant always comes from `auth.restaurantId`. `from`/`to` are inclusive local dates;
 * the date pattern is enforced here, semantic validation lives in `parseReportRange`.
 */
export const reportsRoutes = new Elysia({ prefix: '/reports' })
  .use(authGuard)
  .guard({ auth: ['ADMIN'] })
  .get(
    '/revenue',
    async ({ auth, query }) => {
      const range = parseReportRange({ from: query.from, to: query.to })
      const report = await getRevenueByDay(db, auth.restaurantId, range)
      return { data: report }
    },
    {
      query: t.Object({
        from: t.String({ pattern: DATE_PATTERN }),
        to: t.String({ pattern: DATE_PATTERN }),
      }),
      detail: { tags: ['Reports'], summary: 'Daily revenue over a date range' },
    },
  )
  .get(
    '/top-dishes',
    async ({ auth, query }) => {
      const range = parseReportRange({ from: query.from, to: query.to })
      const dishes = await getTopDishes(db, auth.restaurantId, range, query.limit ?? 10)
      return { data: { dishes } }
    },
    {
      query: t.Object({
        from: t.String({ pattern: DATE_PATTERN }),
        to: t.String({ pattern: DATE_PATTERN }),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 50 })),
      }),
      detail: { tags: ['Reports'], summary: 'Top-selling dishes over a date range' },
    },
  )
