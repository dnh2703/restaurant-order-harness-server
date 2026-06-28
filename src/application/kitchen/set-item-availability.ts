import { and, eq, exists } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { categories, menuItems } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'

/**
 * Toggle a menu item's availability (US-012 / SPEC US-4.3 — temporary sold-out). Same flag as
 * admin availability (US-6.2); the kitchen uses it for short-term stockouts. Tenancy is enforced
 * in the UPDATE itself: the item is updated only when its category belongs to `restaurantId`, so
 * a kitchen token cannot toggle another restaurant's menu. 0 rows → MENU_ITEM_NOT_FOUND. No
 * realtime emission: the customer menu (US-006) is a GET and reflects this on its next read.
 */
export async function setMenuItemAvailability(
  database: Database,
  restaurantId: string,
  menuItemId: string,
  isAvailable: boolean,
): Promise<{ id: string; isAvailable: boolean }> {
  const inRestaurant = exists(
    database
      .select({ one: categories.id })
      .from(categories)
      .where(
        and(eq(categories.id, menuItems.categoryId), eq(categories.restaurantId, restaurantId)),
      ),
  )

  const updated = await database
    .update(menuItems)
    .set({ isAvailable })
    .where(and(eq(menuItems.id, menuItemId), inRestaurant))
    .returning({ id: menuItems.id, isAvailable: menuItems.isAvailable })

  if (!updated[0]) throw new AppError('MENU_ITEM_NOT_FOUND')
  return updated[0]
}
