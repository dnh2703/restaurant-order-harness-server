import { and, eq, exists } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { categories, menuItems } from '../../infrastructure/database/schema'
import { AppError, pgErrorCode } from '../../shared/errors'
import { type MenuItemView, toMenuItemView } from './menu-item-view'

export interface UpdateMenuItemInput {
  categoryId?: string
  name?: string
  price?: number
  description?: string | null
  imageUrl?: string | null
  isAvailable?: boolean
  sortOrder?: number
}

/**
 * Update a menu item (US-015). Tenancy is enforced by an `exists` subquery requiring the item's
 * category to belong to `restaurantId`, so targeting another restaurant's item matches no rows and
 * surfaces as `MENU_ITEM_NOT_FOUND` (404). When `categoryId` is sent (a move), the destination
 * category must also belong to the restaurant, else `CATEGORY_NOT_FOUND` (404); SQLSTATE 23503 maps
 * to the same code as a backstop. Only the fields provided are patched.
 */
export async function updateMenuItemUseCase(
  database: Database,
  restaurantId: string,
  id: string,
  input: UpdateMenuItemInput,
): Promise<MenuItemView> {
  if (input.categoryId !== undefined) {
    const [cat] = await database
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, input.categoryId), eq(categories.restaurantId, restaurantId)))
      .limit(1)
    if (!cat) throw new AppError('CATEGORY_NOT_FOUND')
  }

  const patch: Partial<{
    categoryId: string
    name: string
    price: number
    description: string | null
    imageUrl: string | null
    isAvailable: boolean
    sortOrder: number
  }> = {}
  if (input.categoryId !== undefined) patch.categoryId = input.categoryId
  if (input.name !== undefined) patch.name = input.name
  if (input.price !== undefined) patch.price = input.price
  if (input.description !== undefined) patch.description = input.description
  if (input.imageUrl !== undefined) patch.imageUrl = input.imageUrl
  if (input.isAvailable !== undefined) patch.isAvailable = input.isAvailable
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder

  const inRestaurant = exists(
    database
      .select({ one: categories.id })
      .from(categories)
      .where(
        and(eq(categories.id, menuItems.categoryId), eq(categories.restaurantId, restaurantId)),
      ),
  )
  const scope = and(eq(menuItems.id, id), inRestaurant)

  if (Object.keys(patch).length === 0) {
    const [current] = await database.select().from(menuItems).where(scope).limit(1)
    if (!current) throw new AppError('MENU_ITEM_NOT_FOUND')
    return toMenuItemView(current)
  }

  try {
    const [updated] = await database.update(menuItems).set(patch).where(scope).returning()
    if (!updated) throw new AppError('MENU_ITEM_NOT_FOUND')
    return toMenuItemView(updated)
  } catch (error) {
    if (pgErrorCode(error) === '23503') throw new AppError('CATEGORY_NOT_FOUND')
    throw error
  }
}
