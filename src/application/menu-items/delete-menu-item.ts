import { and, eq, exists } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { categories, menuItems, orderItems } from '../../infrastructure/database/schema'
import { AppError, pgErrorCode } from '../../shared/errors'

/**
 * Delete a menu item (US-015). Tenant-scoped existence check first (the item's category must belong
 * to `restaurantId`) → `MENU_ITEM_NOT_FOUND` (404) for a missing or cross-tenant id. An item still
 * referenced by `order_items` is refused with `MENU_ITEM_IN_USE` (409): we count first for a clean
 * answer, and map the FK violation (SQLSTATE 23503) to the same code so a concurrent order insert
 * between the count and the delete stays safe under Neon's transaction pooling. The item's
 * `option_groups`/`options` cascade away with it.
 */
export async function deleteMenuItemUseCase(
  database: Database,
  restaurantId: string,
  id: string,
): Promise<void> {
  const inRestaurant = exists(
    database
      .select({ one: categories.id })
      .from(categories)
      .where(
        and(eq(categories.id, menuItems.categoryId), eq(categories.restaurantId, restaurantId)),
      ),
  )
  const scope = and(eq(menuItems.id, id), inRestaurant)

  const [current] = await database
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(scope)
    .limit(1)
  if (!current) throw new AppError('MENU_ITEM_NOT_FOUND')

  const [used] = await database
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.menuItemId, id))
    .limit(1)
  if (used) throw new AppError('MENU_ITEM_IN_USE')

  try {
    await database.delete(menuItems).where(scope)
  } catch (error) {
    if (pgErrorCode(error) === '23503') throw new AppError('MENU_ITEM_IN_USE')
    throw error
  }
}
