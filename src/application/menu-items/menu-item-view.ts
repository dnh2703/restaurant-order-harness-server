/**
 * Admin-facing shape of a menu item (US-015). Carries `categoryId` so the route can group/move
 * items; `menu_items` has no `restaurantId` (tenancy flows through the category). Nothing here is
 * sensitive. `description`/`imageUrl` are nullable text columns.
 */
export interface MenuItemView {
  id: string
  categoryId: string
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  isAvailable: boolean
  sortOrder: number
}

export function toMenuItemView(row: {
  id: string
  categoryId: string
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  isAvailable: boolean
  sortOrder: number
}): MenuItemView {
  return {
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    price: row.price,
    imageUrl: row.imageUrl,
    isAvailable: row.isAvailable,
    sortOrder: row.sortOrder,
  }
}
