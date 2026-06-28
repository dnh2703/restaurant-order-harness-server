import { and, asc, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { optionGroups, options } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { type OptionGroupView, toOptionGroupView } from './option-group-view'
import { assertMenuItemInRestaurant } from './scope'

export interface UpdateOptionGroupInput {
  name?: string
  type?: 'SINGLE' | 'MULTI'
  isRequired?: boolean
}

/**
 * Update an option group (US-016). The named menu item must belong to `restaurantId` (else
 * `MENU_ITEM_NOT_FOUND`); the group must exist under that item (else `OPTION_GROUP_NOT_FOUND`).
 * Only the fields provided are patched. Returns the group with its current options. No FK references
 * `option_groups`, so no SQLSTATE backstop is needed.
 */
export async function updateOptionGroupUseCase(
  database: Database,
  restaurantId: string,
  menuItemId: string,
  groupId: string,
  input: UpdateOptionGroupInput,
): Promise<OptionGroupView> {
  await assertMenuItemInRestaurant(database, restaurantId, menuItemId)

  const patch: Partial<{ name: string; type: 'SINGLE' | 'MULTI'; isRequired: boolean }> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.type !== undefined) patch.type = input.type
  if (input.isRequired !== undefined) patch.isRequired = input.isRequired

  const scope = and(eq(optionGroups.id, groupId), eq(optionGroups.menuItemId, menuItemId))

  let group
  if (Object.keys(patch).length === 0) {
    ;[group] = await database.select().from(optionGroups).where(scope).limit(1)
  } else {
    ;[group] = await database.update(optionGroups).set(patch).where(scope).returning()
  }
  if (!group) throw new AppError('OPTION_GROUP_NOT_FOUND')

  const optionRows = await database
    .select()
    .from(options)
    .where(eq(options.optionGroupId, groupId))
    .orderBy(asc(options.name))

  return toOptionGroupView(group, optionRows)
}
