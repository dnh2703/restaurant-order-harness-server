import { eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import {
  categories,
  menuItems,
  optionGroups,
  options,
  tables,
} from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'

/**
 * Customer menu read for a QR session (US-006). Dishes grouped by category, each with its
 * option groups + options and an `isAvailable` flag the FE uses to dim + label "Sold out"
 * (the dish stays in the list, it is not hidden). Implements SPEC US-2.1; search (US-2.2)
 * and option-selection UI (US-2.3) are follow-up slices. See docs/product/menu.md.
 */
export interface MenuOption {
  id: string
  name: string
  priceDelta: number
}

export interface MenuOptionGroup {
  id: string
  name: string
  type: 'SINGLE' | 'MULTI'
  isRequired: boolean
  options: MenuOption[]
}

export interface MenuDish {
  id: string
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  isAvailable: boolean
  optionGroups: MenuOptionGroup[]
}

export interface MenuCategory {
  id: string
  name: string
  items: MenuDish[]
}

export interface Menu {
  categories: MenuCategory[]
}

// Flat rows as returned by the scoped queries below; the input order is the response order.
export interface CategoryRow {
  id: string
  name: string
}
export interface MenuItemRow {
  id: string
  categoryId: string
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  isAvailable: boolean
}
export interface OptionGroupRow {
  id: string
  menuItemId: string
  name: string
  type: 'SINGLE' | 'MULTI'
  isRequired: boolean
}
export interface OptionRow {
  id: string
  optionGroupId: string
  name: string
  priceDelta: number
}

/**
 * Pure assembly of the four flat row sets into the nested menu shape. Each set is assumed
 * pre-ordered by its query; this function preserves that order, so categories and dishes
 * come out in `sort_order` and an empty category still appears (with `items: []`). Kept
 * DB-free so the grouping/nesting is unit-testable without a database.
 */
export function groupMenu(
  categoryRows: CategoryRow[],
  itemRows: MenuItemRow[],
  groupRows: OptionGroupRow[],
  optionRows: OptionRow[],
): Menu {
  const optionsByGroup = new Map<string, MenuOption[]>()
  for (const o of optionRows) {
    const list = optionsByGroup.get(o.optionGroupId) ?? []
    list.push({ id: o.id, name: o.name, priceDelta: o.priceDelta })
    optionsByGroup.set(o.optionGroupId, list)
  }

  const groupsByItem = new Map<string, MenuOptionGroup[]>()
  for (const g of groupRows) {
    const list = groupsByItem.get(g.menuItemId) ?? []
    list.push({
      id: g.id,
      name: g.name,
      type: g.type,
      isRequired: g.isRequired,
      options: optionsByGroup.get(g.id) ?? [],
    })
    groupsByItem.set(g.menuItemId, list)
  }

  const itemsByCategory = new Map<string, MenuDish[]>()
  for (const i of itemRows) {
    const list = itemsByCategory.get(i.categoryId) ?? []
    list.push({
      id: i.id,
      name: i.name,
      description: i.description,
      price: i.price,
      imageUrl: i.imageUrl,
      isAvailable: i.isAvailable,
      optionGroups: groupsByItem.get(i.id) ?? [],
    })
    itemsByCategory.set(i.categoryId, list)
  }

  return {
    categories: categoryRows.map((c) => ({
      id: c.id,
      name: c.name,
      items: itemsByCategory.get(c.id) ?? [],
    })),
  }
}

/**
 * Resolve a `qrToken` to its restaurant and return that restaurant's full menu grouped by
 * category. Unknown/regenerated token → `AppError('INVALID_TABLE')` (404), matching the QR
 * session route. The read is scoped to the resolved restaurant on every query (joins filter
 * by `categories.restaurant_id`), so there is no cross-restaurant leakage.
 *
 * Four explicit-column reads (categories, items, option groups, options) run in parallel and
 * are stitched in memory — a fixed query count regardless of menu size (no N+1), with no
 * `SELECT *` over-fetch.
 */
export async function getMenuForQrToken(database: Database, qrToken: string): Promise<Menu> {
  const [table] = await database
    .select({ restaurantId: tables.restaurantId })
    .from(tables)
    .where(eq(tables.qrToken, qrToken))
    .limit(1)

  if (!table) {
    throw new AppError('INVALID_TABLE')
  }

  const { restaurantId } = table

  const [categoryRows, itemRows, groupRows, optionRows] = await Promise.all([
    database
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.restaurantId, restaurantId))
      .orderBy(categories.sortOrder, categories.name),
    database
      .select({
        id: menuItems.id,
        categoryId: menuItems.categoryId,
        name: menuItems.name,
        description: menuItems.description,
        price: menuItems.price,
        imageUrl: menuItems.imageUrl,
        isAvailable: menuItems.isAvailable,
      })
      .from(menuItems)
      .innerJoin(categories, eq(menuItems.categoryId, categories.id))
      .where(eq(categories.restaurantId, restaurantId))
      .orderBy(menuItems.sortOrder, menuItems.name),
    database
      .select({
        id: optionGroups.id,
        menuItemId: optionGroups.menuItemId,
        name: optionGroups.name,
        type: optionGroups.type,
        isRequired: optionGroups.isRequired,
      })
      .from(optionGroups)
      .innerJoin(menuItems, eq(optionGroups.menuItemId, menuItems.id))
      .innerJoin(categories, eq(menuItems.categoryId, categories.id))
      .where(eq(categories.restaurantId, restaurantId))
      .orderBy(optionGroups.name),
    database
      .select({
        id: options.id,
        optionGroupId: options.optionGroupId,
        name: options.name,
        priceDelta: options.priceDelta,
      })
      .from(options)
      .innerJoin(optionGroups, eq(options.optionGroupId, optionGroups.id))
      .innerJoin(menuItems, eq(optionGroups.menuItemId, menuItems.id))
      .innerJoin(categories, eq(menuItems.categoryId, categories.id))
      .where(eq(categories.restaurantId, restaurantId))
      .orderBy(options.priceDelta, options.name),
  ])

  return groupMenu(categoryRows, itemRows, groupRows, optionRows)
}
