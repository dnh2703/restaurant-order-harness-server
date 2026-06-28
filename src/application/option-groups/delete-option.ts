import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { options } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { assertGroupInRestaurant } from './scope'

/**
 * Delete an option (US-016). The named menu item must belong to `restaurantId` (else
 * `MENU_ITEM_NOT_FOUND`), the group must exist under it (else `OPTION_GROUP_NOT_FOUND`), and the
 * option must exist under that group (else `OPTION_NOT_FOUND`). Order history is never affected
 * (`order_item_options` has no FK back to `options`), so the delete is always safe.
 */
export async function deleteOptionUseCase(
  database: Database,
  restaurantId: string,
  menuItemId: string,
  groupId: string,
  optionId: string,
): Promise<void> {
  await assertGroupInRestaurant(database, restaurantId, menuItemId, groupId)

  const scope = and(eq(options.id, optionId), eq(options.optionGroupId, groupId))
  const [existing] = await database.select({ id: options.id }).from(options).where(scope).limit(1)
  if (!existing) throw new AppError('OPTION_NOT_FOUND')

  await database.delete(options).where(scope)
}
