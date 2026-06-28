import type { Database } from '../../infrastructure/database/client'
import { options } from '../../infrastructure/database/schema'
import { AppError, pgErrorCode } from '../../shared/errors'
import { type OptionView, toOptionView } from './option-group-view'
import { assertGroupInRestaurant } from './scope'

export interface CreateOptionInput {
  name: string
  priceDelta?: number
}

/**
 * Create an option under a group (US-016). The named menu item must belong to `restaurantId` (else
 * `MENU_ITEM_NOT_FOUND`) and the group must exist under it (else `OPTION_GROUP_NOT_FOUND`). SQLSTATE
 * 23503 maps to `OPTION_GROUP_NOT_FOUND` as a backstop for the group being deleted between the check
 * and the insert (Neon transaction pooling). `priceDelta` defaults to 0 and may be negative.
 */
export async function createOptionUseCase(
  database: Database,
  restaurantId: string,
  menuItemId: string,
  groupId: string,
  input: CreateOptionInput,
): Promise<OptionView> {
  await assertGroupInRestaurant(database, restaurantId, menuItemId, groupId)

  try {
    const [created] = await database
      .insert(options)
      .values({ optionGroupId: groupId, name: input.name, priceDelta: input.priceDelta ?? 0 })
      .returning()
    return toOptionView(created!)
  } catch (error) {
    if (pgErrorCode(error) === '23503') throw new AppError('OPTION_GROUP_NOT_FOUND')
    throw error
  }
}
