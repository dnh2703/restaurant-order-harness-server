import { Elysia, t } from 'elysia'

import { resolveTableSession } from '../../../application/sessions/resolve-table-session'
import { db } from '../../../infrastructure/database/client'

/**
 * GET /api/qr/:qrToken — public (unauthenticated) customer entry point. Resolves the QR
 * token to a table and reuses-or-creates the table's single OPEN order, returning the
 * session header (US-005). Unknown/regenerated tokens surface as 404 INVALID_TABLE via
 * the global error handler. See docs/product/tables-qr.md.
 */
export const qrRoutes = new Elysia().get(
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
