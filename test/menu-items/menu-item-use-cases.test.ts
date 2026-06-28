import { randomUUID } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { createMenuItemUseCase } from '../../src/application/menu-items/create-menu-item'
import { deleteMenuItemUseCase } from '../../src/application/menu-items/delete-menu-item'
import { listMenuItemsUseCase } from '../../src/application/menu-items/list-menu-items'
import { updateMenuItemUseCase } from '../../src/application/menu-items/update-menu-item'
import { db } from '../../src/infrastructure/database/client'
import {
  categories,
  menuItems,
  orderItems,
  orders,
  restaurants,
  tables,
} from '../../src/infrastructure/database/schema'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'

let schemaAvailable = false
let restaurantId = ''
let categoryId = ''
let category2Id = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const [r] = await db
    .insert(restaurants)
    .values({ name: `US-015 UC ${randomUUID()}` })
    .returning({ id: restaurants.id })
  restaurantId = r!.id
  const [c1] = await db
    .insert(categories)
    .values({ restaurantId, name: 'Mains', sortOrder: 0 })
    .returning({ id: categories.id })
  categoryId = c1!.id
  const [c2] = await db
    .insert(categories)
    .values({ restaurantId, name: 'Drinks', sortOrder: 1 })
    .returning({ id: categories.id })
  category2Id = c2!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable || !restaurantId) return
  const cats = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.restaurantId, restaurantId))
  const catIds = cats.map((c) => c.id)
  if (catIds.length) await db.delete(menuItems).where(inArray(menuItems.categoryId, catIds))
  await db.delete(categories).where(eq(categories.restaurantId, restaurantId))
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId))
}, DB_TIMEOUT_MS)

describe('createMenuItemUseCase', () => {
  it(
    'defaults isAvailable=true and sortOrder=0 and scopes to the category',
    async () => {
      if (!schemaAvailable) return
      const created = await createMenuItemUseCase(db, restaurantId, {
        categoryId,
        name: 'Pho',
        price: 50000,
      })
      expect(created.name).toBe('Pho')
      expect(created.price).toBe(50000)
      expect(created.isAvailable).toBe(true)
      expect(created.sortOrder).toBe(0)
      expect(created.categoryId).toBe(categoryId)
      expect(created.description).toBeNull()
      expect(created.imageUrl).toBeNull()
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws CATEGORY_NOT_FOUND when the category belongs to another restaurant',
    async () => {
      if (!schemaAvailable) return
      const [r2] = await db
        .insert(restaurants)
        .values({ name: `US-015 Other ${randomUUID()}` })
        .returning({ id: restaurants.id })
      const [foreignCat] = await db
        .insert(categories)
        .values({ restaurantId: r2!.id, name: 'Foreign', sortOrder: 0 })
        .returning({ id: categories.id })
      await expect(
        createMenuItemUseCase(db, restaurantId, {
          categoryId: foreignCat!.id,
          name: 'Sneaky',
          price: 1000,
        }),
      ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
      await db.delete(categories).where(eq(categories.id, foreignCat!.id))
      await db.delete(restaurants).where(eq(restaurants.id, r2!.id))
    },
    DB_TIMEOUT_MS,
  )
})

describe('listMenuItemsUseCase', () => {
  it(
    'lists all items of the restaurant ordered by category then item, with optional categoryId filter',
    async () => {
      if (!schemaAvailable) return
      await createMenuItemUseCase(db, restaurantId, {
        categoryId: category2Id,
        name: 'Cola',
        price: 15000,
        sortOrder: 1,
      })
      await createMenuItemUseCase(db, restaurantId, {
        categoryId: category2Id,
        name: 'Beer',
        price: 25000,
        sortOrder: 0,
      })

      const all = await listMenuItemsUseCase(db, restaurantId)
      const names = all.map((i) => i.name)
      // category Mains (sortOrder 0) before Drinks (sortOrder 1); within Drinks, Beer (0) before Cola (1)
      expect(names.indexOf('Pho')).toBeLessThan(names.indexOf('Beer'))
      expect(names.indexOf('Beer')).toBeLessThan(names.indexOf('Cola'))

      const drinksOnly = await listMenuItemsUseCase(db, restaurantId, category2Id)
      expect(drinksOnly.every((i) => i.categoryId === category2Id)).toBe(true)
      expect(drinksOnly.some((i) => i.name === 'Pho')).toBe(false)
    },
    DB_TIMEOUT_MS,
  )
})

describe('updateMenuItemUseCase', () => {
  it(
    'patches only the fields provided',
    async () => {
      if (!schemaAvailable) return
      const created = await createMenuItemUseCase(db, restaurantId, {
        categoryId,
        name: 'Temp',
        price: 1000,
        sortOrder: 3,
      })
      const updated = await updateMenuItemUseCase(db, restaurantId, created.id, { price: 2000 })
      expect(updated.price).toBe(2000)
      expect(updated.name).toBe('Temp')
      expect(updated.sortOrder).toBe(3)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'moves an item to another of the restaurant categories',
    async () => {
      if (!schemaAvailable) return
      const created = await createMenuItemUseCase(db, restaurantId, {
        categoryId,
        name: 'Movable',
        price: 1000,
      })
      const moved = await updateMenuItemUseCase(db, restaurantId, created.id, {
        categoryId: category2Id,
      })
      expect(moved.categoryId).toBe(category2Id)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws MENU_ITEM_NOT_FOUND for an item owned by another restaurant',
    async () => {
      if (!schemaAvailable) return
      const [r2] = await db
        .insert(restaurants)
        .values({ name: `US-015 Other ${randomUUID()}` })
        .returning({ id: restaurants.id })
      const [foreignCat] = await db
        .insert(categories)
        .values({ restaurantId: r2!.id, name: 'Foreign', sortOrder: 0 })
        .returning({ id: categories.id })
      const foreignItem = await createMenuItemUseCase(db, r2!.id, {
        categoryId: foreignCat!.id,
        name: 'Theirs',
        price: 1000,
      })
      await expect(
        updateMenuItemUseCase(db, restaurantId, foreignItem.id, { name: 'Hijack' }),
      ).rejects.toMatchObject({ code: 'MENU_ITEM_NOT_FOUND' })
      await db.delete(menuItems).where(eq(menuItems.id, foreignItem.id))
      await db.delete(categories).where(eq(categories.id, foreignCat!.id))
      await db.delete(restaurants).where(eq(restaurants.id, r2!.id))
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws CATEGORY_NOT_FOUND when moving into another restaurant category',
    async () => {
      if (!schemaAvailable) return
      const created = await createMenuItemUseCase(db, restaurantId, {
        categoryId,
        name: 'StayHome',
        price: 1000,
      })
      const [r2] = await db
        .insert(restaurants)
        .values({ name: `US-015 Other ${randomUUID()}` })
        .returning({ id: restaurants.id })
      const [foreignCat] = await db
        .insert(categories)
        .values({ restaurantId: r2!.id, name: 'Foreign', sortOrder: 0 })
        .returning({ id: categories.id })
      await expect(
        updateMenuItemUseCase(db, restaurantId, created.id, { categoryId: foreignCat!.id }),
      ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
      await db.delete(categories).where(eq(categories.id, foreignCat!.id))
      await db.delete(restaurants).where(eq(restaurants.id, r2!.id))
    },
    DB_TIMEOUT_MS,
  )
})

describe('deleteMenuItemUseCase', () => {
  it(
    'deletes an item with no order history',
    async () => {
      if (!schemaAvailable) return
      const created = await createMenuItemUseCase(db, restaurantId, {
        categoryId,
        name: 'ToDelete',
        price: 1000,
      })
      await deleteMenuItemUseCase(db, restaurantId, created.id)
      const all = await listMenuItemsUseCase(db, restaurantId)
      expect(all.some((i) => i.id === created.id)).toBe(false)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'refuses to delete an item referenced by order history — MENU_ITEM_IN_USE',
    async () => {
      if (!schemaAvailable) return
      const item = await createMenuItemUseCase(db, restaurantId, {
        categoryId,
        name: 'Ordered',
        price: 1000,
      })
      const [table] = await db
        .insert(tables)
        .values({ restaurantId, name: 'T1', qrToken: `qr-${randomUUID()}` })
        .returning({ id: tables.id })
      const [order] = await db
        .insert(orders)
        .values({ restaurantId, tableId: table!.id })
        .returning({ id: orders.id })
      await db.insert(orderItems).values({
        orderId: order!.id,
        menuItemId: item.id,
        nameSnapshot: item.name,
        unitPrice: item.price,
        quantity: 1,
      })
      await expect(deleteMenuItemUseCase(db, restaurantId, item.id)).rejects.toMatchObject({
        code: 'MENU_ITEM_IN_USE',
      })
      // cleanup the order chain so afterAll can drop categories/restaurant
      await db.delete(orders).where(eq(orders.id, order!.id)) // cascades order_items
      await db.delete(tables).where(eq(tables.id, table!.id))
      await db.delete(menuItems).where(eq(menuItems.id, item.id))
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws MENU_ITEM_NOT_FOUND for an item owned by another restaurant',
    async () => {
      if (!schemaAvailable) return
      const [r2] = await db
        .insert(restaurants)
        .values({ name: `US-015 Other ${randomUUID()}` })
        .returning({ id: restaurants.id })
      const [foreignCat] = await db
        .insert(categories)
        .values({ restaurantId: r2!.id, name: 'Foreign', sortOrder: 0 })
        .returning({ id: categories.id })
      const foreignItem = await createMenuItemUseCase(db, r2!.id, {
        categoryId: foreignCat!.id,
        name: 'Theirs',
        price: 1000,
      })
      await expect(deleteMenuItemUseCase(db, restaurantId, foreignItem.id)).rejects.toMatchObject({
        code: 'MENU_ITEM_NOT_FOUND',
      })
      await db.delete(menuItems).where(eq(menuItems.id, foreignItem.id))
      await db.delete(categories).where(eq(categories.id, foreignCat!.id))
      await db.delete(restaurants).where(eq(restaurants.id, r2!.id))
    },
    DB_TIMEOUT_MS,
  )
})
