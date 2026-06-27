import { Elysia } from 'elysia'

import { env } from '../../../infrastructure/config/env'

/**
 * Maps thrown/validation errors to the project's error envelope:
 *   { "error": { "code", "message", "details"? } }
 * See docs/product/api-conventions.md. `code` is a stable SCREAMING_SNAKE string;
 * clients branch on `code`, not `message`.
 */
export const errorHandler = new Elysia({ name: 'error-handler' }).onError(
  { as: 'global' },
  ({ code, error, set }) => {
    switch (code) {
      case 'VALIDATION':
        set.status = 400
        return {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: error.all,
          },
        }
      case 'NOT_FOUND':
        set.status = 404
        return { error: { code: 'NOT_FOUND', message: 'Resource not found' } }
      case 'PARSE':
        set.status = 400
        return { error: { code: 'MALFORMED_REQUEST', message: 'Could not parse request body' } }
      default: {
        set.status = 500
        const message = error instanceof Error ? error.message : 'Internal server error'
        if (!env.isProduction) console.error('[unhandled]', error)
        return {
          error: {
            code: 'INTERNAL_ERROR',
            message: env.isProduction ? 'Internal server error' : message,
          },
        }
      }
    }
  },
)
