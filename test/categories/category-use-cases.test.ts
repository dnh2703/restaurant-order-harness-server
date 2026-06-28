import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { createCategoryUseCase } from '../../src/application/categories/create-category'
import { listCategoriesUseCase } from '../../src/application/categories/list-categories'
import { db } from '../../src/infrastructure/database/client'
import { categories, restaurants } from '../../src/infrastructure/database/schema'
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
