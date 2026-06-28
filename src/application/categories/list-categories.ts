import { asc, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { categories } from '../../infrastructure/database/schema'
import { type CategoryView, toCategoryView } from './category-view'

/**
 * List every category in a restaurant (US-014), ordered by `sortOrder` then `name` so the
 * admin list matches the customer menu grouping (US-006). Scoped to `restaurantId` from the
 * authenticated admin's claims.
 */
export async function listCategoriesUseCase(
  database: Database,
  restaurantId: string,
): Promise<CategoryView[]> {
  const rows = await database
    .select()
    .from(categories)
    .where(eq(categories.restaurantId, restaurantId))
    .orderBy(asc(categories.sortOrder), asc(categories.name))
  return rows.map(toCategoryView)
}
