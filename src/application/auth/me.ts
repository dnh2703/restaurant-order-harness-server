import { and, eq } from 'drizzle-orm'

import type { AccessTokenClaims } from '../../infrastructure/auth/access-token'
import type { Database } from '../../infrastructure/database/client'
import { users } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { type PublicUser, toPublicUser } from './user-view'

/**
 * Resolve the current user's profile from verified access-token claims (US-8.1). The
 * lookup is scoped by `restaurantId` from the token (tenant scope) and re-checks
 * `isActive`, so a token issued before a deactivation stops resolving. A token whose user
 * no longer exists / is inactive is treated as unauthenticated (401).
 */
export async function meUseCase(
  database: Database,
  claims: AccessTokenClaims,
): Promise<PublicUser> {
  const [user] = await database
    .select()
    .from(users)
    .where(and(eq(users.id, claims.userId), eq(users.restaurantId, claims.restaurantId)))
    .limit(1)

  if (!user || !user.isActive) {
    throw new AppError('UNAUTHORIZED')
  }

  return toPublicUser(user)
}
