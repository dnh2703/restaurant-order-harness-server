import { and, asc, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { categories, menuItems } from '../../infrastructure/database/schema'
import { type MenuItemView, toMenuItemView } from './menu-item-view'

/**
 * List menu items for a restaurant (US-015). `menu_items` has no `restaurantId`, so tenancy is
 * enforced by joining `categories` and filtering on `categories.restaurantId`. Ordered by category
 * (`sortOrder`, `name`) then item (`sortOrder`, `name`) to mirror the customer menu grouping
 * (US-006). An optional `categoryId` narrows the list to one group.
 */
export async function listMenuItemsUseCase(
  database: Database,
  restaurantId: string,
  categoryId?: string,
): Promise<MenuItemView[]> {
  const where =
    categoryId === undefined
      ? eq(categories.restaurantId, restaurantId)
      : and(eq(categories.restaurantId, restaurantId), eq(menuItems.categoryId, categoryId))

  const rows = await database
    .select({
      id: menuItems.id,
      categoryId: menuItems.categoryId,
      name: menuItems.name,
      description: menuItems.description,
      price: menuItems.price,
      imageUrl: menuItems.imageUrl,
      isAvailable: menuItems.isAvailable,
      sortOrder: menuItems.sortOrder,
    })
    .from(menuItems)
    .innerJoin(categories, eq(categories.id, menuItems.categoryId))
    .where(where)
    .orderBy(
      asc(categories.sortOrder),
      asc(categories.name),
      asc(menuItems.sortOrder),
      asc(menuItems.name),
    )

  return rows.map(toMenuItemView)
}
