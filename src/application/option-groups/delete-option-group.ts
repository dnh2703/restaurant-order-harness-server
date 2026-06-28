import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { optionGroups } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { assertMenuItemInRestaurant } from './scope'

/**
 * Delete an option group (US-016). The named menu item must belong to `restaurantId` (else
 * `MENU_ITEM_NOT_FOUND`); the group must exist under that item (else `OPTION_GROUP_NOT_FOUND`). The
 * group's `options` cascade away with it (`onDelete: 'cascade'`). Order history is never affected —
 * `order_item_options` snapshots option data with no FK back to `options`/`option_groups` — so the
 * delete is always safe (no in-use guard, no SQLSTATE backstop).
 */
export async function deleteOptionGroupUseCase(
  database: Database,
  restaurantId: string,
  menuItemId: string,
  groupId: string,
): Promise<void> {
  await assertMenuItemInRestaurant(database, restaurantId, menuItemId)

  const scope = and(eq(optionGroups.id, groupId), eq(optionGroups.menuItemId, menuItemId))
  const [existing] = await database
    .select({ id: optionGroups.id })
    .from(optionGroups)
    .where(scope)
    .limit(1)
  if (!existing) throw new AppError('OPTION_GROUP_NOT_FOUND')

  await database.delete(optionGroups).where(scope)
}
