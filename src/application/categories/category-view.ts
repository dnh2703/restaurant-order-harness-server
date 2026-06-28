/**
 * Admin-facing shape of a menu category (US-014). Carries `restaurantId` so the route can
 * assert tenant ownership in responses; excludes nothing sensitive (categories hold no secrets).
 */
export interface CategoryView {
  id: string
  restaurantId: string
  name: string
  sortOrder: number
}

export function toCategoryView(row: {
  id: string
  restaurantId: string
  name: string
  sortOrder: number
}): CategoryView {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    name: row.name,
    sortOrder: row.sortOrder,
  }
}
