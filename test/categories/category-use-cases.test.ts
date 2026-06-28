import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { createCategoryUseCase } from '../../src/application/categories/create-category'
import { deleteCategoryUseCase } from '../../src/application/categories/delete-category'
import { listCategoriesUseCase } from '../../src/application/categories/list-categories'
import { updateCategoryUseCase } from '../../src/application/categories/update-category'
import { db } from '../../src/infrastructure/database/client'
import { categories, menuItems, restaurants } from '../../src/infrastructure/database/schema'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'

let schemaAvailable = false
let restaurantId = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const [r] = await db
    .insert(restaurants)
    .values({ name: `US-014 UC ${randomUUID()}` })
    .returning({ id: restaurants.id })
  restaurantId = r!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable || !restaurantId) return
  const cats = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.restaurantId, restaurantId))
  for (const c of cats) await db.delete(menuItems).where(eq(menuItems.categoryId, c.id))
  await db.delete(categories).where(eq(categories.restaurantId, restaurantId))
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId))
}, DB_TIMEOUT_MS)

describe('createCategoryUseCase', () => {
  it(
    'defaults sortOrder to 0 and scopes to the restaurant',
    async () => {
      if (!schemaAvailable) return
      const created = await createCategoryUseCase(db, restaurantId, { name: 'Mains' })
      expect(created.name).toBe('Mains')
      expect(created.sortOrder).toBe(0)
      expect(created.restaurantId).toBe(restaurantId)
    },
    DB_TIMEOUT_MS,
  )
})

describe('listCategoriesUseCase', () => {
  it(
    'returns the restaurant categories ordered by sortOrder then name',
    async () => {
      if (!schemaAvailable) return
      await createCategoryUseCase(db, restaurantId, { name: 'Zeta', sortOrder: 1 })
      await createCategoryUseCase(db, restaurantId, { name: 'Alpha', sortOrder: 5 })
      const list = await listCategoriesUseCase(db, restaurantId)
      const names = list.map((c) => c.name)
      // sortOrder 0 (Mains) first, then 1 (Zeta), then 5 (Alpha)
      expect(names.indexOf('Mains')).toBeLessThan(names.indexOf('Zeta'))
      expect(names.indexOf('Zeta')).toBeLessThan(names.indexOf('Alpha'))
      for (const c of list) expect(c.restaurantId).toBe(restaurantId)
    },
    DB_TIMEOUT_MS,
  )
})

describe('updateCategoryUseCase', () => {
  it(
    'patches only the fields provided',
    async () => {
      if (!schemaAvailable) return
      const created = await createCategoryUseCase(db, restaurantId, { name: 'Temp', sortOrder: 2 })
      const updated = await updateCategoryUseCase(db, restaurantId, created.id, { name: 'Renamed' })
      expect(updated.name).toBe('Renamed')
      expect(updated.sortOrder).toBe(2)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws CATEGORY_NOT_FOUND for an unknown id',
    async () => {
      if (!schemaAvailable) return
      const call = updateCategoryUseCase(db, restaurantId, randomUUID(), { name: 'x' })
      await expect(call).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
    },
    DB_TIMEOUT_MS,
  )
})

describe('deleteCategoryUseCase', () => {
  it(
    'deletes an empty category',
    async () => {
      if (!schemaAvailable) return
      const created = await createCategoryUseCase(db, restaurantId, { name: 'ToDelete' })
      await deleteCategoryUseCase(db, restaurantId, created.id)
      const after = await listCategoriesUseCase(db, restaurantId)
      expect(after.some((c) => c.id === created.id)).toBe(false)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'refuses to delete a category that still has menu items — CATEGORY_NOT_EMPTY',
    async () => {
      if (!schemaAvailable) return
      const created = await createCategoryUseCase(db, restaurantId, { name: 'HasItems' })
      await db.insert(menuItems).values({ categoryId: created.id, name: 'Dish', price: 1000 })
      const call = deleteCategoryUseCase(db, restaurantId, created.id)
      await expect(call).rejects.toMatchObject({ code: 'CATEGORY_NOT_EMPTY' })
    },
    DB_TIMEOUT_MS,
  )
})
