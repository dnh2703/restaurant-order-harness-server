import { ERROR_CATALOG, type ErrorCode } from './error-catalog'

/**
 * Application/domain error carrying a stable error `code`. Throw this from any layer;
 * the HTTP error handler maps it to the standard envelope and status. The default
 * message/status come from the catalog, but either can be overridden per throw, and
 * `details` can carry machine-readable context for the client.
 *
 * @example
 *   throw new AppError('NOT_FOUND')
 *   throw new AppError('VALIDATION_ERROR', { details: { field: 'email' } })
 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: ErrorCode, options?: { message?: string; details?: unknown }) {
    const definition = ERROR_CATALOG[code]
    super(options?.message ?? definition.message)
    this.name = 'AppError'
    this.code = code
    this.status = definition.status
    this.details = options?.details
  }
}
