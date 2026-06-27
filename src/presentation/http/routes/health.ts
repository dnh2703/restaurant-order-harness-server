import { Elysia } from 'elysia'

import { checkDatabase } from '../../../infrastructure/database/health'

/**
 * GET /api/health — liveness + database connectivity smoke endpoint.
 * 200 { data: { status: 'ok' } } when the DB round-trips;
 * 503 { error: { code: 'DB_UNAVAILABLE' } } when it does not.
 */
export const healthRoutes = new Elysia().get('/health', async ({ set }) => {
  try {
    await checkDatabase()
    return { data: { status: 'ok' as const } }
  } catch {
    set.status = 503
    return {
      error: {
        code: 'DB_UNAVAILABLE',
        message: 'Database connectivity check failed',
      },
    }
  }
})
