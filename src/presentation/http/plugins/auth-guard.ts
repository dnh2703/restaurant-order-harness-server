import { Elysia } from 'elysia'

import {
  type AccessTokenClaims,
  type Role,
  verifyAccessToken,
} from '../../../infrastructure/auth/access-token'
import { AppError } from '../../../shared/errors'

/**
 * Authentication + RBAC guard (US-009). A reusable Elysia plugin exposing an `auth` macro:
 *
 *   .get('/me',    handler, { auth: true })        // any authenticated staff
 *   .get('/board', handler, { auth: ['KITCHEN'] }) // only these role(s)
 *
 * The macro reads `Authorization: Bearer <jwt>`, verifies the access token, and resolves
 * the verified identity onto `context.auth` as `{ userId, role, restaurantId }`. Routes
 * MUST take `restaurantId` from `auth` (never the request body/query) so a token can never
 * reach another tenant's data.
 *
 * Failures throw `AppError`, which the global error handler maps to the standard envelope:
 *  - missing / malformed / invalid / expired access token → 401 UNAUTHORIZED
 *  - authenticated but role not allowed                   → 403 FORBIDDEN
 *
 * Customer QR routes never use this macro and stay unauthenticated (authorized by qr_token).
 */

const BEARER = /^Bearer (.+)$/i

function extractBearerToken(authorization: string | undefined): string {
  const match = authorization?.match(BEARER)
  if (!match) throw new AppError('UNAUTHORIZED')
  return match[1]!.trim()
}

async function authenticate(authorization: string | undefined): Promise<AccessTokenClaims> {
  const token = extractBearerToken(authorization)
  try {
    return await verifyAccessToken(token)
  } catch {
    // Any jose failure (bad signature, malformed, expired) is an auth failure, not a 500.
    throw new AppError('UNAUTHORIZED')
  }
}

export const authGuard = new Elysia({ name: 'auth-guard' }).macro(
  'auth',
  (roles: Role[] | true) => ({
    async resolve({ headers }: { headers: Record<string, string | undefined> }) {
      const auth = await authenticate(headers.authorization)
      if (Array.isArray(roles) && roles.length > 0 && !roles.includes(auth.role)) {
        throw new AppError('FORBIDDEN')
      }
      return { auth }
    },
  }),
)
