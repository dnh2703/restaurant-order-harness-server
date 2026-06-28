import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { categories, menuItems, optionGroups } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'

/**
 * Tenancy guards for the option tree (US-016). `option_groups`/`options` have no `restaurantId`, so
 * scope flows through `menu_item → category → restaurant`. These run as single autocommit reads
 * before each write so the check order (item → group) produces the precise 404, and a cross-tenant
 * id is indistinguishable from a missing one.
 */
export async function assertMenuItemInRestaurant(
  database: Database,
  restaurantId: string,
  menuItemId: string,
): Promise<void> {
  const [item] = await database
    .select({ id: menuItems.id })
    .from(menuItems)
    .innerJoin(categories, eq(categories.id, menuItems.categoryId))
    .where(and(eq(menuItems.id, menuItemId), eq(categories.restaurantId, restaurantId)))
    .limit(1)
  if (!item) throw new AppError('MENU_ITEM_NOT_FOUND')
}

export async function assertGroupInRestaurant(
  database: Database,
  restaurantId: string,
  menuItemId: string,
  groupId: string,
): Promise<void> {
  await assertMenuItemInRestaurant(database, restaurantId, menuItemId)
  const [group] = await database
    .select({ id: optionGroups.id })
    .from(optionGroups)
    .where(and(eq(optionGroups.id, groupId), eq(optionGroups.menuItemId, menuItemId)))
    .limit(1)
  if (!group) throw new AppError('OPTION_GROUP_NOT_FOUND')
}
