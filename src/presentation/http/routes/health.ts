import { Elysia, t } from 'elysia'

import { checkDatabase } from '../../../infrastructure/database/health'
import { AppError } from '../../../shared/errors'

/**
 * GET /api/health — liveness + database connectivity smoke endpoint.
 * 200 { data: { status: 'ok' } } when the DB round-trips; otherwise the global error
 * handler turns the thrown AppError into 503 { error: { code: 'DB_UNAVAILABLE' } }.
 */
export const healthRoutes = new Elysia().get(
  '/health',
  async () => {
    try {
      await checkDatabase()
    } catch {
      throw new AppError('DB_UNAVAILABLE')
    }

    return { data: { status: 'ok' as const } }
  },
  {
    detail: {
      tags: ['Health'],
      summary: 'Liveness and database connectivity check',
    },
    response: {
      200: t.Object({ data: t.Object({ status: t.Literal('ok') }) }),
    },
  },
)
