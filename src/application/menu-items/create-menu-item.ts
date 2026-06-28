import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { categories, menuItems } from '../../infrastructure/database/schema'
import { AppError, pgErrorCode } from '../../shared/errors'
import { type MenuItemView, toMenuItemView } from './menu-item-view'

export interface CreateMenuItemInput {
  categoryId: string
  name: string
  price: number
  description?: string | null
  imageUrl?: string | null
  isAvailable?: boolean
  sortOrder?: number
}

/**
 * Create a menu item in one of the admin's categories (US-015). The target category must belong to
 * `restaurantId` — checked first (the FK on `menu_items.category_id` only proves existence, not
 * tenant) and surfaced as `CATEGORY_NOT_FOUND` (404). SQLSTATE 23503 maps to the same code as a
 * backstop for the category being deleted between the check and the insert (Neon transaction
 * pooling). `isAvailable` defaults true, `sortOrder` defaults 0; `description`/`imageUrl` default null.
 */
export async function createMenuItemUseCase(
  database: Database,
  restaurantId: string,
  input: CreateMenuItemInput,
): Promise<MenuItemView> {
  const [cat] = await database
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, input.categoryId), eq(categories.restaurantId, restaurantId)))
    .limit(1)
  if (!cat) throw new AppError('CATEGORY_NOT_FOUND')

  try {
    const [created] = await database
      .insert(menuItems)
      .values({
        categoryId: input.categoryId,
        name: input.name,
        price: input.price,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        isAvailable: input.isAvailable ?? true,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning()
    return toMenuItemView(created!)
  } catch (error) {
    if (pgErrorCode(error) === '23503') throw new AppError('CATEGORY_NOT_FOUND')
    throw error
  }
}
