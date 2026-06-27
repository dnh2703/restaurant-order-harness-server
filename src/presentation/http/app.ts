import { Elysia } from 'elysia'

import { errorHandler } from './plugins/error-handler'
import { healthRoutes } from './routes/health'

/**
 * HTTP application composition root. All routes are mounted under /api
 * (see docs/product/api-conventions.md). Exported without `.listen()` so tests can
 * drive it via `app.handle(...)`; src/index.ts owns the actual listen.
 */
export const app = new Elysia({ prefix: '/api' }).use(errorHandler).use(healthRoutes)

export type App = typeof app
