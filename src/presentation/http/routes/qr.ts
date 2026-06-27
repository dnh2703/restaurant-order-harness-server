import { Elysia, t } from 'elysia'

import { getMenuForQrToken } from '../../../application/menu/get-menu'
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

/**
 * Public (unauthenticated) customer QR routes. Both resolve `:qrToken`; an
 * unknown/regenerated token surfaces as 404 INVALID_TABLE via the global error handler.
 * See docs/product/tables-qr.md and docs/product/menu.md.
 *
 * - GET /api/qr/:qrToken       resolve table + open/reuse the order session (US-005).
 * - GET /api/qr/:qrToken/menu  read the restaurant's menu grouped by category (US-006).
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
