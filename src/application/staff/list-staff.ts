import { eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { users } from '../../infrastructure/database/schema'
import { type StaffView, toStaffView } from './staff-view'

/**
 * List every staff member in a restaurant (US-010). Scoped to `restaurantId` from the
 * authenticated admin's claims so an admin can never enumerate another tenant's users.
 * Never returns `passwordHash`.
 */
export async function listStaffUseCase(
  database: Database,
  restaurantId: string,
): Promise<StaffView[]> {
  const rows = await database.select().from(users).where(eq(users.restaurantId, restaurantId))
  return rows.map(toStaffView)
}
