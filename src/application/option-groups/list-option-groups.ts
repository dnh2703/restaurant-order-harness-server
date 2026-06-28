import { asc, eq, inArray } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { optionGroups, options } from '../../infrastructure/database/schema'
import { type OptionGroupView, toOptionGroupView } from './option-group-view'
import { assertMenuItemInRestaurant } from './scope'

/**
 * List a menu item's option groups, each with its nested options (US-016). The item must belong to
 * the admin's restaurant (else `MENU_ITEM_NOT_FOUND`). Groups and options have no `sort_order`
 * column, so both are ordered by `name` for a deterministic result. Options are fetched in one
 * `inArray` query and grouped in memory to avoid an N+1.
 */
export async function listOptionGroupsUseCase(
  database: Database,
  restaurantId: string,
  menuItemId: string,
): Promise<OptionGroupView[]> {
  await assertMenuItemInRestaurant(database, restaurantId, menuItemId)

  const groups = await database
    .select()
    .from(optionGroups)
    .where(eq(optionGroups.menuItemId, menuItemId))
    .orderBy(asc(optionGroups.name))

  if (groups.length === 0) return []

  const groupIds = groups.map((g) => g.id)
  const optionRows = await database
    .select()
    .from(options)
    .where(inArray(options.optionGroupId, groupIds))
    .orderBy(asc(options.name))

  return groups.map((g) =>
    toOptionGroupView(
      g,
      optionRows.filter((o) => o.optionGroupId === g.id),
    ),
  )
}
