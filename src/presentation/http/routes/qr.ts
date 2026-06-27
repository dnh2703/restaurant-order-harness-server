import { Elysia, t } from 'elysia'

import { getMenuForQrToken } from '../../../application/menu/get-menu'
import { addOrderItems } from '../../../application/orders/add-order-items'
import { getOrderForQrToken } from '../../../application/orders/get-order'
import { resolveTableSession } from '../../../application/sessions/resolve-table-session'
import { db } from '../../../infrastructure/database/client'

const menuOption = t.Object({
  id: t.String({ format: 'uuid' }),
  name: t.String(),
  priceDelta: t.Integer(),
})

const menuOptionGroup = t.Object({
  id: t.String({ format: 'uuid' }),
  name: t.String(),
  type: t.Union([t.Literal('SINGLE'), t.Literal('MULTI')]),
  isRequired: t.Boolean(),
  options: t.Array(menuOption),
})

const menuDish = t.Object({
  id: t.String({ format: 'uuid' }),
  name: t.String(),
  description: t.Nullable(t.String()),
  price: t.Integer(),
  imageUrl: t.Nullable(t.String()),
  isAvailable: t.Boolean(),
  optionGroups: t.Array(menuOptionGroup),
})

const menuCategory = t.Object({
  id: t.String({ format: 'uuid' }),
  name: t.String(),
  items: t.Array(menuDish),
})

const addOrderItemsBody = t.Object({
  items: t.Array(
    t.Object({
      menuItemId: t.String({ format: 'uuid' }),
      // Integer (not min:1) so a non-positive quantity surfaces as the domain's 422
      // INVALID_QUANTITY rather than a 400 validation error (see docs/product/ordering.md).
      quantity: t.Integer(),
      note: t.Optional(t.Nullable(t.String())),
      optionIds: t.Optional(t.Array(t.String({ format: 'uuid' }))),
    }),
    { minItems: 1 },
  ),
})

const orderItemView = t.Object({
  id: t.String({ format: 'uuid' }),
  menuItemId: t.String({ format: 'uuid' }),
  nameSnapshot: t.String(),
  unitPrice: t.Integer(),
  quantity: t.Integer(),
  note: t.Nullable(t.String()),
  status: t.Union([
    t.Literal('PENDING'),
    t.Literal('COOKING'),
    t.Literal('SERVED'),
    t.Literal('CANCELLED'),
  ]),
  createdAt: t.String({ format: 'date-time' }),
  options: t.Array(t.Object({ optionName: t.String(), priceDelta: t.Integer() })),
})

const orderView = t.Object({
  id: t.String({ format: 'uuid' }),
  status: t.Union([t.Literal('OPEN'), t.Literal('PAID'), t.Literal('CANCELLED')]),
  subtotal: t.Integer(),
  discountAmount: t.Integer(),
  total: t.Integer(),
  openedAt: t.String({ format: 'date-time' }),
  items: t.Array(orderItemView),
})

/**
 * Public (unauthenticated) customer QR routes. Both resolve `:qrToken`; an
 * unknown/regenerated token surfaces as 404 INVALID_TABLE via the global error handler.
 * See docs/product/tables-qr.md and docs/product/menu.md.
 *
 * - GET  /api/qr/:qrToken              resolve table + open/reuse the order session (US-005).
 * - GET  /api/qr/:qrToken/menu         read the restaurant's menu grouped by category (US-006).
 * - POST /api/qr/:qrToken/order-items  append cart items to the OPEN order (US-007).
 * - GET  /api/qr/:qrToken/order        read the current order with items + statuses (US-007).
 */
export const qrRoutes = new Elysia()
  .get(
    '/qr/:qrToken',
    async ({ params }) => {
      const data = await resolveTableSession(db, params.qrToken)
      return { data }
    },
    {
      detail: {
        tags: ['QR Session'],
        summary: 'Resolve a table QR token and open/reuse its order session',
      },
      response: {
        200: t.Object({
          data: t.Object({
            restaurant: t.Object({ name: t.String() }),
            table: t.Object({
              id: t.String({ format: 'uuid' }),
              name: t.String(),
              status: t.Union([t.Literal('EMPTY'), t.Literal('OCCUPIED')]),
            }),
            session: t.Object({
              orderId: t.String({ format: 'uuid' }),
              status: t.Literal('OPEN'),
              openedAt: t.String({ format: 'date-time' }),
            }),
          }),
        }),
      },
    },
  )
  .get(
    '/qr/:qrToken/menu',
    async ({ params }) => {
      const data = await getMenuForQrToken(db, params.qrToken)
      return { data }
    },
    {
      detail: {
        tags: ['QR Session'],
        summary: 'Read the menu for a QR session, grouped by category',
      },
      response: {
        200: t.Object({
          data: t.Object({
            categories: t.Array(menuCategory),
          }),
        }),
      },
    },
  )
  .post(
    '/qr/:qrToken/order-items',
    async ({ params, body, set }) => {
      const data = await addOrderItems(db, params.qrToken, body)
      set.status = 201
      return { data }
    },
    {
      body: addOrderItemsBody,
      detail: {
        tags: ['QR Session'],
        summary: "Append cart items to the QR session's OPEN order",
      },
      response: {
        201: t.Object({ data: orderView }),
      },
    },
  )
  .get(
    '/qr/:qrToken/order',
    async ({ params }) => {
      const data = await getOrderForQrToken(db, params.qrToken)
      return { data }
    },
    {
      detail: {
        tags: ['QR Session'],
        summary: 'Read the current order for a QR session with items + statuses',
      },
      response: {
        200: t.Object({ data: orderView }),
      },
    },
  )
