import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { options } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { type OptionView, toOptionView } from './option-group-view'
import { assertGroupInRestaurant } from './scope'

export interface UpdateOptionInput {
  name?: string
  priceDelta?: number
}

/**
 * Update an option (US-016). The named menu item must belong to `restaurantId` (else
 * `MENU_ITEM_NOT_FOUND`), the group must exist under it (else `OPTION_GROUP_NOT_FOUND`), and the
 * option must exist under that group (else `OPTION_NOT_FOUND`). Only the fields provided are
 * patched. `priceDelta` may be negative.
 */
export async function updateOptionUseCase(
  database: Database,
  restaurantId: string,
  menuItemId: string,
  groupId: string,
  optionId: string,
  input: UpdateOptionInput,
): Promise<OptionView> {
  await assertGroupInRestaurant(database, restaurantId, menuItemId, groupId)

  const patch: Partial<{ name: string; priceDelta: number }> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.priceDelta !== undefined) patch.priceDelta = input.priceDelta

  const scope = and(eq(options.id, optionId), eq(options.optionGroupId, groupId))

  let option
  if (Object.keys(patch).length === 0) {
    ;[option] = await database.select().from(options).where(scope).limit(1)
  } else {
    ;[option] = await database.update(options).set(patch).where(scope).returning()
  }
  if (!option) throw new AppError('OPTION_NOT_FOUND')

  return toOptionView(option)
}
