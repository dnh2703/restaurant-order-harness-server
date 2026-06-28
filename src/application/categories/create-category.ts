import type { Database } from '../../infrastructure/database/client'
import { categories } from '../../infrastructure/database/schema'
import { type CategoryView, toCategoryView } from './category-view'

export interface CreateCategoryInput {
  name: string
  sortOrder?: number
}

/**
 * Create a category in the admin's restaurant (US-014). `restaurantId` comes from the
 * authenticated admin's claims, never the request body; `sortOrder` defaults to 0.
 */
export async function createCategoryUseCase(
  database: Database,
  restaurantId: string,
  input: CreateCategoryInput,
): Promise<CategoryView> {
  const [created] = await database
    .insert(categories)
    .values({
      restaurantId,
      name: input.name,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning()
  return toCategoryView(created!)
}
