import { and, eq } from 'drizzle-orm'

import type { Role } from '../../infrastructure/auth/access-token'
import type { Database } from '../../infrastructure/database/client'
import { users } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { hasOtherActiveAdmin } from './last-admin'
import { type StaffView, toStaffView } from './staff-view'

export interface UpdateStaffInput {
  name?: string
  role?: Role
}

/**
 * Update a staff member's name and/or role (US-010). The update is tenant-scoped: the
 * `WHERE` clause matches both `userId` and the admin's `restaurantId`, so targeting another
 * restaurant's user simply matches no rows and surfaces as `USER_NOT_FOUND` (404) — the
 * same response a truly missing id gets, so existence in other tenants is never revealed.
 *
 * Demoting the last active admin is refused with `LAST_ADMIN` (409) so a restaurant can
 * never be left with no one able to manage staff.
 */
export async function updateStaffUseCase(
  database: Database,
  restaurantId: string,
  userId: string,
  input: UpdateStaffInput,
): Promise<StaffView> {
  const patch: Partial<{ name: string; role: Role }> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.role !== undefined) patch.role = input.role

  const scope = and(eq(users.id, userId), eq(users.restaurantId, restaurantId))

  const [current] = await database.select().from(users).where(scope).limit(1)
  if (!current) throw new AppError('USER_NOT_FOUND')

  // Demoting an active admin away from ADMIN must leave at least one other active admin.
  const demotesAdmin =
    current.role === 'ADMIN' &&
    current.isActive &&
    patch.role !== undefined &&
    patch.role !== 'ADMIN'
  if (demotesAdmin && !(await hasOtherActiveAdmin(database, restaurantId, userId))) {
    throw new AppError('LAST_ADMIN')
  }

  if (Object.keys(patch).length === 0) {
    return toStaffView(current)
  }

  const [updated] = await database.update(users).set(patch).where(scope).returning()
  if (!updated) throw new AppError('USER_NOT_FOUND')
  return toStaffView(updated)
}
