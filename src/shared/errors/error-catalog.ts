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

  // Auth & RBAC (US-009)
  INVALID_CREDENTIALS: { status: 401, message: 'Email or password is incorrect' },
  UNAUTHORIZED: { status: 401, message: 'Authentication required' },
  TOKEN_REVOKED: { status: 401, message: 'Refresh token is no longer valid' },
  TOKEN_EXPIRED: { status: 401, message: 'Refresh token has expired' },
  FORBIDDEN: { status: 403, message: 'You do not have access to this resource' },

  // Staff administration (US-010)
  EMAIL_TAKEN: { status: 409, message: 'A user with this email already exists' },
  USER_NOT_FOUND: { status: 404, message: 'User not found' },
  LAST_ADMIN: {
    status: 409,
    message: 'Cannot demote or deactivate the last active admin of the restaurant',
  },

  // Menu category administration (US-014)
  CATEGORY_NOT_FOUND: { status: 404, message: 'Category not found' },
  CATEGORY_NOT_EMPTY: {
    status: 409,
    message: 'Cannot delete a category that still has menu items',
  },

  // Menu item administration (US-015)
  MENU_ITEM_IN_USE: {
    status: 409,
    message: 'Cannot delete a menu item that is referenced by order history',
  },

  // Option groups & options administration (US-016)
  OPTION_GROUP_NOT_FOUND: { status: 404, message: 'Option group not found' },
  OPTION_NOT_FOUND: { status: 404, message: 'Option not found' },

  // Table administration (US-017)
  TABLE_NOT_FOUND: { status: 404, message: 'Table not found' },
  TABLE_IN_USE: {
    status: 409,
    message: 'Cannot delete a table referenced by an order',
  },

  // Tables & QR sessions (US-005)
  INVALID_TABLE: { status: 404, message: 'QR code does not resolve to a known table' },

  // Kitchen (US-011)
  INVALID_TRANSITION: { status: 409, message: 'Illegal order item status transition' },

  // Ordering (US-007)
  MENU_ITEM_NOT_FOUND: { status: 404, message: 'Menu item does not exist for this restaurant' },
  ITEM_UNAVAILABLE: { status: 409, message: 'Menu item is currently unavailable' },
  INVALID_QUANTITY: { status: 422, message: 'Quantity must be at least 1' },
  MISSING_REQUIRED_OPTION: { status: 422, message: 'A required option group requires a selection' },
  INVALID_OPTION: { status: 422, message: 'Selected option is not valid for this menu item' },

  // Cashier & payment (US-018)
  ORDER_NOT_FOUND: { status: 404, message: 'Order not found' },

  // Infrastructure
  DB_UNAVAILABLE: { status: 503, message: 'Database connectivity check failed' },
} as const satisfies Record<string, ErrorDefinition>

/** Union of every valid error code, derived from the catalog keys. */
export type ErrorCode = keyof typeof ERROR_CATALOG
