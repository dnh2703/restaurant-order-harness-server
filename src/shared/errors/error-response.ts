import { ERROR_CATALOG, type ErrorCode } from './error-catalog'

/** The error envelope shape from docs/product/api-conventions.md. */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode
    message: string
    details?: unknown
  }
}

/**
 * Builds the standard error envelope for a code, defaulting the message from the
 * catalog. `details` is included only when provided.
 */
export function errorEnvelope(
  code: ErrorCode,
  options?: { message?: string; details?: unknown },
): ErrorEnvelope {
  const error: ErrorEnvelope['error'] = {
    code,
    message: options?.message ?? ERROR_CATALOG[code].message,
  }
  if (options?.details !== undefined) error.details = options.details
  return { error }
}
