import { Elysia } from 'elysia'

import { env } from '../../../infrastructure/config/env'
import { AppError, ERROR_CATALOG, errorEnvelope } from '../../../shared/errors'

/**
 * Maps thrown/validation errors to the project's error envelope:
 *   { "error": { "code", "message", "details"? } }
 * Codes, messages, and statuses come from the shared error catalog
 * (src/shared/errors). See docs/product/api-conventions.md.
 */
export const errorHandler = new Elysia({ name: 'error-handler' }).onError(
  { as: 'global' },
  ({ code, error, set }) => {
    // Application/domain errors carry their own code + status.
    if (error instanceof AppError) {
      set.status = error.status
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
        if (!env.isProduction) console.error('[unhandled]', error)
        // Never leak internal error text in production.
        const message = !env.isProduction && error instanceof Error ? error.message : undefined
        return errorEnvelope('INTERNAL_ERROR', { message })
      }
    }
  },
)
