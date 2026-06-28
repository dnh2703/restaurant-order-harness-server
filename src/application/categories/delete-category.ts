import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { categories, menuItems } from '../../infrastructure/database/schema'
import { AppError, pgErrorCode } from '../../shared/errors'

/**
 * Delete a category (US-014). Tenant-scoped existence check first → `CATEGORY_NOT_FOUND` (404)
 * for a missing or cross-tenant id. A category that still has `menu_items` is refused with
 * `CATEGORY_NOT_EMPTY` (409): we count first for a clean answer, and also map the FK violation
 * (SQLSTATE 23503) to the same code so a concurrent insert between the count and the delete is
 * still safe under Neon's transaction pooling.
 */
export async function deleteCategoryUseCase(
  database: Database,
  restaurantId: string,
  id: string,
): Promise<void> {
  const scope = and(eq(categories.id, id), eq(categories.restaurantId, restaurantId))

  const [current] = await database
    .select({ id: categories.id })
    .from(categories)
    .where(scope)
    .limit(1)
  if (!current) throw new AppError('CATEGORY_NOT_FOUND')

  const [item] = await database
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(eq(menuItems.categoryId, id))
    .limit(1)
  if (item) throw new AppError('CATEGORY_NOT_EMPTY')

  try {
    await database.delete(categories).where(scope)
  } catch (error) {
    if (pgErrorCode(error) === '23503') throw new AppError('CATEGORY_NOT_EMPTY')
    throw error
  }
}
