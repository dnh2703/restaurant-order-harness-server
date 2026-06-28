import { randomUUID } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { setMenuItemAvailability } from '../../src/application/kitchen/set-item-availability'
import { db } from '../../src/infrastructure/database/client'
import { categories, menuItems, restaurants } from '../../src/infrastructure/database/schema'
import { AppError } from '../../src/shared/errors'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'

let schemaAvailable = false
let restaurantId = ''
let otherRestaurantId = ''
let menuItemId = ''
const createdRestaurantIds: string[] = []

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const [r] = await db
    .insert(restaurants)
    .values({ name: `KA ${randomUUID()}` })
    .returning({ id: restaurants.id })
  restaurantId = r!.id
  createdRestaurantIds.push(restaurantId)
  const [other] = await db
    .insert(restaurants)
    .values({ name: `KA-other ${randomUUID()}` })
    .returning({ id: restaurants.id })
  otherRestaurantId = other!.id
  createdRestaurantIds.push(otherRestaurantId)
  const [c] = await db
    .insert(categories)
    .values({ restaurantId, name: 'Cat' })
    .returning({ id: categories.id })
  const [m] = await db
    .insert(menuItems)
    .values({ categoryId: c!.id, name: 'Pho', price: 50000 })
    .returning({ id: menuItems.id })
  menuItemId = m!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable) return
  await db.delete(menuItems).where(eq(menuItems.id, menuItemId))
  await db.delete(categories).where(eq(categories.restaurantId, restaurantId))
  await db.delete(restaurants).where(inArray(restaurants.id, createdRestaurantIds))
}, DB_TIMEOUT_MS)

describe('setMenuItemAvailability', () => {
  it(
    'marks an item sold out and back available',
    async () => {
      if (!schemaAvailable) return
      const off = await setMenuItemAvailability(db, restaurantId, menuItemId, false)
      expect(off).toEqual({ id: menuItemId, isAvailable: false })
      const [row] = await db
        .select({ a: menuItems.isAvailable })
        .from(menuItems)
        .where(eq(menuItems.id, menuItemId))
      expect(row!.a).toBe(false)
      await setMenuItemAvailability(db, restaurantId, menuItemId, true)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects an item from another restaurant with MENU_ITEM_NOT_FOUND',
    async () => {
      if (!schemaAvailable) return
      let code: string | undefined
      try {
        await setMenuItemAvailability(db, otherRestaurantId, menuItemId, false)
      } catch (e) {
        code = (e as AppError).code
      }
      expect(code).toBe('MENU_ITEM_NOT_FOUND')
    },
    DB_TIMEOUT_MS,
  )
})
