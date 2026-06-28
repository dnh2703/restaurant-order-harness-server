import { Elysia } from 'elysia'

import { errorHandler } from './plugins/error-handler'
import { openapiPlugin } from './plugins/openapi'
import { authRoutes } from './routes/auth'
import { categoriesRoutes } from './routes/categories'
import { healthRoutes } from './routes/health'
import { kitchenRoutes } from './routes/kitchen'
import { menuItemsRoutes } from './routes/menu-items'
import { optionGroupsRoutes } from './routes/option-groups'
import { qrRoutes } from './routes/qr'
import { staffRoutes } from './routes/staff'
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
  .use(staffRoutes)
  .use(categoriesRoutes)
  .use(menuItemsRoutes)
  .use(optionGroupsRoutes)
  .use(kitchenRoutes)
  .use(qrRoutes)
  .use(streamRoutes)

export type App = typeof app
