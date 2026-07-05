import { env } from '../../../infrastructure/config/env'
import { createRateLimiting } from './rate-limit'

/**
 * The app-wide rate-limiting instance, built from validated config (US-023). Kept separate
 * from `rate-limit.ts` (which stays env-free and unit-testable) and from `app.ts` (to avoid
 * an import cycle with the auth route that needs `loginGuard`).
 */
export const rateLimiting = createRateLimiting(env.rateLimit)
