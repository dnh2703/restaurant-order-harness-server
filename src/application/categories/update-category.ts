import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { categories } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { type CategoryView, toCategoryView } from './category-view'

export interface UpdateCategoryInput {
  name?: string
  sortOrder?: number
}

/**
 * Update a category (US-014). Tenant-scoped: the WHERE matches both `id` and the admin's
 * `restaurantId`, so targeting another restaurant's category matches no rows and surfaces as
 * `CATEGORY_NOT_FOUND` (404) — identical to a truly missing id, leaking nothing cross-tenant.
 */
export async function updateCategoryUseCase(
  database: Database,
  restaurantId: string,
  id: string,
  input: UpdateCategoryInput,
): Promise<CategoryView> {
  const patch: Partial<{ name: string; sortOrder: number }> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder

  const scope = and(eq(categories.id, id), eq(categories.restaurantId, restaurantId))

  if (Object.keys(patch).length === 0) {
    const [current] = await database.select().from(categories).where(scope).limit(1)
    if (!current) throw new AppError('CATEGORY_NOT_FOUND')
    return toCategoryView(current)
  }

  const [updated] = await database.update(categories).set(patch).where(scope).returning()
  if (!updated) throw new AppError('CATEGORY_NOT_FOUND')
  return toCategoryView(updated)
}
