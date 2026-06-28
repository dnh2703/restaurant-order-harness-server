import { randomUUID } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { createOptionGroupUseCase } from '../../src/application/option-groups/create-option-group'
import { listOptionGroupsUseCase } from '../../src/application/option-groups/list-option-groups'
import { db } from '../../src/infrastructure/database/client'
import { categories, menuItems, restaurants } from '../../src/infrastructure/database/schema'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'

let schemaAvailable = false
let restaurantId = ''
let menuItemId = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const [r] = await db
    .insert(restaurants)
    .values({ name: `US-016 UC ${randomUUID()}` })
    .returning({ id: restaurants.id })
  restaurantId = r!.id
  const [c] = await db
    .insert(categories)
    .values({ restaurantId, name: 'Mains', sortOrder: 0 })
    .returning({ id: categories.id })
  const [item] = await db
    .insert(menuItems)
    .values({ categoryId: c!.id, name: 'Pho', price: 50000 })
    .returning({ id: menuItems.id })
  menuItemId = item!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable || !restaurantId) return
  const cats = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.restaurantId, restaurantId))
  const catIds = cats.map((c) => c.id)
  // deleting menu items cascades option_groups → options
  if (catIds.length) await db.delete(menuItems).where(inArray(menuItems.categoryId, catIds))
  await db.delete(categories).where(eq(categories.restaurantId, restaurantId))
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId))
}, DB_TIMEOUT_MS)

describe('createOptionGroupUseCase', () => {
  it(
    'defaults isRequired=false and returns an empty options array',
    async () => {
      if (!schemaAvailable) return
      const group = await createOptionGroupUseCase(db, restaurantId, menuItemId, {
        name: 'Topping',
        type: 'MULTI',
      })
      expect(group.name).toBe('Topping')
      expect(group.type).toBe('MULTI')
      expect(group.isRequired).toBe(false)
      expect(group.menuItemId).toBe(menuItemId)
      expect(group.options).toEqual([])
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws MENU_ITEM_NOT_FOUND when the menu item belongs to another restaurant',
    async () => {
      if (!schemaAvailable) return
      const [r2] = await db
        .insert(restaurants)
        .values({ name: `US-016 Other ${randomUUID()}` })
        .returning({ id: restaurants.id })
      const [c2] = await db
        .insert(categories)
        .values({ restaurantId: r2!.id, name: 'Foreign', sortOrder: 0 })
        .returning({ id: categories.id })
      const [foreignItem] = await db
        .insert(menuItems)
        .values({ categoryId: c2!.id, name: 'Theirs', price: 1000 })
        .returning({ id: menuItems.id })
      await expect(
        createOptionGroupUseCase(db, restaurantId, foreignItem!.id, {
          name: 'Sneaky',
          type: 'SINGLE',
        }),
      ).rejects.toMatchObject({ code: 'MENU_ITEM_NOT_FOUND' })
      await db.delete(menuItems).where(eq(menuItems.id, foreignItem!.id))
      await db.delete(categories).where(eq(categories.id, c2!.id))
      await db.delete(restaurants).where(eq(restaurants.id, r2!.id))
    },
    DB_TIMEOUT_MS,
  )
})

describe('listOptionGroupsUseCase', () => {
  it(
    'lists the item groups ordered by name, each with its options',
    async () => {
      if (!schemaAvailable) return
      const sizeGroup = await createOptionGroupUseCase(db, restaurantId, menuItemId, {
        name: 'Size',
        type: 'SINGLE',
        isRequired: true,
      })
      const groups = await listOptionGroupsUseCase(db, restaurantId, menuItemId)
      const names = groups.map((g) => g.name)
      // 'Size' sorts before 'Topping'
      expect(names.indexOf('Size')).toBeLessThan(names.indexOf('Topping'))
      const size = groups.find((g) => g.id === sizeGroup.id)
      expect(size).toBeDefined()
      expect(Array.isArray(size!.options)).toBe(true)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws MENU_ITEM_NOT_FOUND when listing groups of another restaurant item',
    async () => {
      if (!schemaAvailable) return
      const [r2] = await db
        .insert(restaurants)
        .values({ name: `US-016 Other ${randomUUID()}` })
        .returning({ id: restaurants.id })
      const [c2] = await db
        .insert(categories)
        .values({ restaurantId: r2!.id, name: 'Foreign', sortOrder: 0 })
        .returning({ id: categories.id })
      const [foreignItem] = await db
        .insert(menuItems)
        .values({ categoryId: c2!.id, name: 'Theirs', price: 1000 })
        .returning({ id: menuItems.id })
      await expect(
        listOptionGroupsUseCase(db, restaurantId, foreignItem!.id),
      ).rejects.toMatchObject({ code: 'MENU_ITEM_NOT_FOUND' })
      await db.delete(menuItems).where(eq(menuItems.id, foreignItem!.id))
      await db.delete(categories).where(eq(categories.id, c2!.id))
      await db.delete(restaurants).where(eq(restaurants.id, r2!.id))
    },
    DB_TIMEOUT_MS,
  )
})
