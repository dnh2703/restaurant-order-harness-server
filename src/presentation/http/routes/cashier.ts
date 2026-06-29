import { Elysia, t } from 'elysia'

import { applyDiscount } from '../../../application/cashier/apply-discount'
import { getBill } from '../../../application/cashier/get-bill'
import { listOpenTables } from '../../../application/cashier/list-open-tables'
import { db } from '../../../infrastructure/database/client'
import { authGuard } from '../plugins/auth-guard'

const idParams = t.Object({ id: t.String({ format: 'uuid' }) })

const openTable = t.Object({
  orderId: t.String({ format: 'uuid' }),
  tableId: t.String({ format: 'uuid' }),
  tableName: t.String(),
  subtotal: t.Integer(),
  discountAmount: t.Integer(),
  total: t.Integer(),
  openedAt: t.String(),
  itemCount: t.Integer(),
})

/**
 * Cashier & payment API (E08 / SPEC EPIC 5). Every route is guarded `['CASHIER','ADMIN']` and
 * tenant-scoped: the restaurant always comes from `auth.restaurantId`, never the body/params.
 */
export const cashierRoutes = new Elysia({ prefix: '/cashier' })
  .use(authGuard)
  .guard({ auth: ['CASHIER', 'ADMIN'] })
  .get(
    '/tables',
    async ({ auth }) => {
      const tables = await listOpenTables(db, auth.restaurantId)
      return { data: { tables } }
    },
    {
      detail: { tags: ['Cashier'], summary: 'List open tables with running totals' },
      response: { 200: t.Object({ data: t.Object({ tables: t.Array(openTable) }) }) },
    },
  )
  .get(
    '/orders/:id',
    async ({ auth, params }) => {
      const order = await getBill(db, auth.restaurantId, params.id)
      return { data: { order } }
    },
    {
      params: idParams,
      detail: { tags: ['Cashier'], summary: 'Bill detail for one order' },
    },
  )
  .patch(
    '/orders/:id/discount',
    async ({ auth, params, body }) => {
      const order = await applyDiscount(db, auth.restaurantId, params.id, body)
      return { data: { order } }
    },
    {
      params: idParams,
      body: t.Object({
        type: t.Union([t.Literal('PERCENT'), t.Literal('FIXED')]),
        value: t.Integer({ minimum: 0 }),
        reason: t.Optional(t.String()),
      }),
      detail: { tags: ['Cashier'], summary: 'Apply a discount (PERCENT or FIXED)' },
    },
  )
