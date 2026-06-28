import type { Database } from '../../infrastructure/database/client'
import { optionGroups } from '../../infrastructure/database/schema'
import { AppError, pgErrorCode } from '../../shared/errors'
import { type OptionGroupView, toOptionGroupView } from './option-group-view'
import { assertMenuItemInRestaurant } from './scope'

export interface CreateOptionGroupInput {
  name: string
  type: 'SINGLE' | 'MULTI'
  isRequired?: boolean
}

/**
 * Create an option group under one of the admin's menu items (US-016). The item must belong to
 * `restaurantId` — checked first and surfaced as `MENU_ITEM_NOT_FOUND` (404). SQLSTATE 23503 maps to
 * the same code as a backstop for the item being deleted between the check and the insert (Neon
 * transaction pooling). `isRequired` defaults false. A new group has no options yet.
 */
export async function createOptionGroupUseCase(
  database: Database,
  restaurantId: string,
  menuItemId: string,
  input: CreateOptionGroupInput,
): Promise<OptionGroupView> {
  await assertMenuItemInRestaurant(database, restaurantId, menuItemId)

  try {
    const [created] = await database
      .insert(optionGroups)
      .values({
        menuItemId,
        name: input.name,
        type: input.type,
        isRequired: input.isRequired ?? false,
      })
      .returning()
    return toOptionGroupView(created!, [])
  } catch (error) {
    if (pgErrorCode(error) === '23503') throw new AppError('MENU_ITEM_NOT_FOUND')
    throw error
  }
}
