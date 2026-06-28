import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { refreshTokens, users } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { hasOtherActiveAdmin } from './last-admin'
import { type StaffView, toStaffView } from './staff-view'

/**
 * Enable or disable a staff account (US-010). Tenant-scoped like the other staff
 * use-cases: targeting another restaurant's user matches no rows → `USER_NOT_FOUND` (404).
 *
 * Disabling is the security-critical path: after flipping `is_active = false` we revoke all
 * of the user's refresh tokens so existing sessions cannot mint new access tokens. The two
 * writes run as sequential autocommit statements (no multi-statement transaction) to stay
 * friendly to Neon's PgBouncer transaction pooling, matching the rest of the app. Flipping
 * the flag first means that even if revocation failed, `refreshUseCase` re-checks
 * `is_active` and revokes the family as defense in depth.
 */
export async function setStaffActiveUseCase(
  database: Database,
  restaurantId: string,
  userId: string,
  isActive: boolean,
): Promise<StaffView> {
  const scope = and(eq(users.id, userId), eq(users.restaurantId, restaurantId))

  const [current] = await database.select().from(users).where(scope).limit(1)
  if (!current) throw new AppError('USER_NOT_FOUND')

  // Deactivating an active admin must leave at least one other active admin.
  if (
    !isActive &&
    current.role === 'ADMIN' &&
    current.isActive &&
    !(await hasOtherActiveAdmin(database, restaurantId, userId))
  ) {
    throw new AppError('LAST_ADMIN')
  }

  const [updated] = await database.update(users).set({ isActive }).where(scope).returning()
  if (!updated) throw new AppError('USER_NOT_FOUND')

  if (!isActive) {
    await database
      .update(refreshTokens)
      .set({ revoked: true })
      .where(eq(refreshTokens.userId, userId))
  }

  return toStaffView(updated)
}
