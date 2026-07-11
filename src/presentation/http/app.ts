import { Elysia } from 'elysia'

import { env } from '../../infrastructure/config/env'
import { errorHandler } from './plugins/error-handler'
import { openapiPlugin } from './plugins/openapi'
import { rateLimiting } from './plugins/rate-limit-instance'
import { requestLogger } from './plugins/request-logger'
import { securityHeaders } from './plugins/security-headers'
import { authRoutes } from './routes/auth'
import { cashierRoutes } from './routes/cashier'
import { categoriesRoutes } from './routes/categories'
import { healthRoutes } from './routes/health'
import { kitchenRoutes } from './routes/kitchen'
import { menuItemsRoutes } from './routes/menu-items'
import { optionGroupsRoutes } from './routes/option-groups'
import { qrRoutes } from './routes/qr'
import { reportsRoutes } from './routes/reports'
import { staffRoutes } from './routes/staff'
import { tablesRoutes } from './routes/tables'

/**
 * The OpenAPI docs/spec are useful in dev but are a recon aid in production, so gate them
 * behind `!isProduction` (US-024). In production this is a no-op plugin, so `/api/docs` and
 * `/api/docs/json` return 404.
 */
const openapiOrNoop = env.isProduction ? new Elysia({ name: 'openapi-disabled' }) : openapiPlugin

/**
 * HTTP application composition root. All routes are mounted under /api
 * (see docs/product/api-conventions.md). Exported without `.listen()` so tests can
 * drive it via `app.handle(...)`; src/index.ts owns the actual listen.
 *
 * `serve.maxRequestBodySize` caps request bodies at the Bun layer so oversized payloads are
 * rejected before a handler buffers them (US-024).
 */
export const app = new Elysia({
  prefix: '/api',
  serve: { maxRequestBodySize: env.maxRequestBodyBytes },
})
  .use(requestLogger())
  .use(errorHandler())
  .use(securityHeaders({ hsts: env.isProduction }))
  .use(openapiOrNoop)
  .use(rateLimiting.globalPlugin)
  .use(healthRoutes)
  .use(authRoutes)
  .use(cashierRoutes)
  .use(staffRoutes)
  .use(categoriesRoutes)
  .use(menuItemsRoutes)
  .use(optionGroupsRoutes)
  .use(kitchenRoutes)
  .use(qrRoutes)
  .use(reportsRoutes)
  .use(tablesRoutes)

export type App = typeof app
