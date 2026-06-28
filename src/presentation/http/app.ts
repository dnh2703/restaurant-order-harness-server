import { Elysia } from 'elysia'

import { errorHandler } from './plugins/error-handler'
import { openapiPlugin } from './plugins/openapi'
import { authRoutes } from './routes/auth'
import { healthRoutes } from './routes/health'
import { qrRoutes } from './routes/qr'
import { streamRoutes } from './routes/stream'

/**
 * HTTP application composition root. All routes are mounted under /api
 * (see docs/product/api-conventions.md). Exported without `.listen()` so tests can
 * drive it via `app.handle(...)`; src/index.ts owns the actual listen.
 */
export const app = new Elysia({ prefix: '/api' })
  .use(errorHandler)
  .use(openapiPlugin)
  .use(healthRoutes)
  .use(authRoutes)
  .use(qrRoutes)
  .use(streamRoutes)

export type App = typeof app
