import { and, eq, ne } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { users } from '../../infrastructure/database/schema'

/**
 * Whether the restaurant still has an active `ADMIN` other than `excludeUserId` (US-010).
 * Used to block demoting or deactivating the last admin, which would otherwise lock the
 * restaurant out of staff administration entirely.
 */
export async function hasOtherActiveAdmin(
  database: Database,
  restaurantId: string,
  excludeUserId: string,
): Promise<boolean> {
  const [other] = await database
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.restaurantId, restaurantId),
        eq(users.role, 'ADMIN'),
        eq(users.isActive, true),
        ne(users.id, excludeUserId),
      ),
    )
    .limit(1)
  return Boolean(other)
}
