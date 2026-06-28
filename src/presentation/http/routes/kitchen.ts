import { Elysia, t } from 'elysia'

import { advanceItemStatus } from '../../../application/kitchen/advance-item-status'
import { getKitchenQueue } from '../../../application/kitchen/get-queue'
import { setMenuItemAvailability } from '../../../application/kitchen/set-item-availability'
import { db } from '../../../infrastructure/database/client'
import { authGuard } from '../plugins/auth-guard'

const idParams = t.Object({ id: t.String({ format: 'uuid' }) })

const queueItem = t.Object({
  id: t.String({ format: 'uuid' }),
  tableName: t.String(),
  nameSnapshot: t.String(),
  quantity: t.Integer(),
  note: t.Union([t.String(), t.Null()]),
  status: t.Union([t.Literal('PENDING'), t.Literal('COOKING')]),
  createdAt: t.String(),
  options: t.Array(t.Object({ optionName: t.String(), priceDelta: t.Integer() })),
})

/**
 * Kitchen screen API (E07 / SPEC EPIC 4). Every route is guarded `['KITCHEN','ADMIN']` and
 * tenant-scoped: the restaurant always comes from the authenticated token (`auth.restaurantId`),
 * never the request body/params. Status writes ride the existing order_items NOTIFY trigger, so
 * the customer (US-008) and staff (US-013) streams update with no extra publish here.
 */
export const kitchenRoutes = new Elysia({ prefix: '/kitchen' })
  .use(authGuard)
  .guard({ auth: ['KITCHEN', 'ADMIN'] })
  .get(
    '/queue',
    async ({ auth }) => {
      const items = await getKitchenQueue(db, auth.restaurantId)
      return { data: { items } }
    },
    {
      detail: { tags: ['Kitchen'], summary: 'PENDING+COOKING make-queue, oldest first' },
      response: { 200: t.Object({ data: t.Object({ items: t.Array(queueItem) }) }) },
    },
  )
  .patch(
    '/order-items/:id/status',
    async ({ auth, params, body }) => {
      const item = await advanceItemStatus(db, auth.restaurantId, params.id, body.status)
      return { data: { item } }
    },
    {
      params: idParams,
      body: t.Object({ status: t.Union([t.Literal('COOKING'), t.Literal('SERVED')]) }),
      detail: { tags: ['Kitchen'], summary: 'Advance an item PENDING→COOKING→SERVED' },
      response: {
        200: t.Object({
          data: t.Object({
            item: t.Object({
              id: t.String({ format: 'uuid' }),
              status: t.Union([t.Literal('COOKING'), t.Literal('SERVED')]),
            }),
          }),
        }),
      },
    },
  )
  .patch(
    '/menu-items/:id/availability',
    async ({ auth, params, body }) => {
      const item = await setMenuItemAvailability(db, auth.restaurantId, params.id, body.isAvailable)
      return { data: { item } }
    },
    {
      params: idParams,
      body: t.Object({ isAvailable: t.Boolean() }),
      detail: { tags: ['Kitchen'], summary: 'Toggle a menu item sold-out / available' },
      response: {
        200: t.Object({
          data: t.Object({
            item: t.Object({ id: t.String({ format: 'uuid' }), isAvailable: t.Boolean() }),
          }),
        }),
      },
    },
  )
