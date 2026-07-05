import { Elysia } from 'elysia'
import type { Logger } from 'pino'

import { env } from '../../../infrastructure/config/env'
import { logger as defaultLogger } from '../../../infrastructure/logging/logger'
import { AppError, ERROR_CATALOG, errorEnvelope } from '../../../shared/errors'

/**
 * Maps thrown/validation errors to the project's error envelope:
 *   { "error": { "code", "message", "details"? } }
 * Codes, messages, and statuses come from the shared error catalog
 * (src/shared/errors). See docs/product/api-conventions.md.
 *
 * The logger is injectable for tests; production uses the shared pino instance.
 */
export function errorHandler(log: Logger = defaultLogger) {
  return new Elysia({ name: 'error-handler' }).onError({ as: 'global' }, (ctx) => {
    const { code, error, set } = ctx
    const requestId = (ctx as { requestId?: string }).requestId

    // Application/domain errors carry their own code + status.
    if (error instanceof AppError) {
      set.status = error.status
      // Surface Retry-After for throttled requests (US-023); the value rides in details.
      if (error.code === 'TOO_MANY_REQUESTS') {
        const retryAfter = (error.details as { retryAfterSeconds?: number } | undefined)
          ?.retryAfterSeconds
        if (typeof retryAfter === 'number') set.headers['retry-after'] = String(retryAfter)
      }
      return errorEnvelope(error.code, { message: error.message, details: error.details })
    }

    // Framework-level errors raised by Elysia.
    switch (code) {
      case 'VALIDATION':
        set.status = ERROR_CATALOG.VALIDATION_ERROR.status
        return errorEnvelope('VALIDATION_ERROR', { details: error.all })
      case 'NOT_FOUND':
        set.status = ERROR_CATALOG.NOT_FOUND.status
        return errorEnvelope('NOT_FOUND')
      case 'PARSE':
        set.status = ERROR_CATALOG.MALFORMED_REQUEST.status
        return errorEnvelope('MALFORMED_REQUEST')
      default: {
        set.status = ERROR_CATALOG.INTERNAL_ERROR.status
        // Log the real error server-side in EVERY environment (this is the fix —
        // previously suppressed in production, leaving prod 500s invisible).
        log.error({ err: error, requestId }, 'unhandled error')
        // Never leak internal error text in the response body in production.
        const message = !env.isProduction && error instanceof Error ? error.message : undefined
        return errorEnvelope('INTERNAL_ERROR', { message })
      }
    }
  })
}
