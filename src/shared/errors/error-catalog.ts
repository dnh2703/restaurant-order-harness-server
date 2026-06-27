/**
 * Single source of truth for API error codes. Each code maps to a stable
 * SCREAMING_SNAKE string (the wire contract — clients branch on `code`, not message),
 * a default human message, and the HTTP status it produces.
 *
 * To add an error: add a key here. Throw it anywhere with `new AppError('THE_CODE')`
 * (see ./app-error). Domain codes (INVALID_TABLE, INVALID_TRANSITION, EMAIL_TAKEN, ...)
 * land here as their stories are built — keep this list to codes actually in use.
 *
 * See docs/product/api-conventions.md.
 */

export interface ErrorDefinition {
  /** HTTP status returned for this error. */
  readonly status: number
  /** Default human-readable message; can be overridden per throw. */
  readonly message: string
}

export const ERROR_CATALOG = {
  // Cross-cutting / framework
  VALIDATION_ERROR: { status: 400, message: 'Request validation failed' },
  MALFORMED_REQUEST: { status: 400, message: 'Could not parse request body' },
  NOT_FOUND: { status: 404, message: 'Resource not found' },
  INTERNAL_ERROR: { status: 500, message: 'Internal server error' },

  // Tables & QR sessions (US-005)
  INVALID_TABLE: { status: 404, message: 'QR code does not resolve to a known table' },

  // Ordering (US-007)
  MENU_ITEM_NOT_FOUND: { status: 404, message: 'Menu item does not exist for this restaurant' },
  ITEM_UNAVAILABLE: { status: 409, message: 'Menu item is currently unavailable' },
  INVALID_QUANTITY: { status: 422, message: 'Quantity must be at least 1' },
  MISSING_REQUIRED_OPTION: { status: 422, message: 'A required option group requires a selection' },
  INVALID_OPTION: { status: 422, message: 'Selected option is not valid for this menu item' },

  // Infrastructure
  DB_UNAVAILABLE: { status: 503, message: 'Database connectivity check failed' },
} as const satisfies Record<string, ErrorDefinition>

/** Union of every valid error code, derived from the catalog keys. */
export type ErrorCode = keyof typeof ERROR_CATALOG
