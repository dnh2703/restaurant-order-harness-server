import { randomUUID } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { advanceItemStatus } from '../../src/application/kitchen/advance-item-status'
import { db } from '../../src/infrastructure/database/client'
import {
  categories,
  menuItems,
  orderItems,
  orders,
  restaurants,
  tables,
} from '../../src/infrastructure/database/schema'
import { AppError } from '../../src/shared/errors'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'

let schemaAvailable = false
let restaurantId = ''
let otherRestaurantId = ''
let menuItemId = ''
let orderId = ''

const createdRestaurantIds: string[] = []

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return

  const [r] = await db
    .insert(restaurants)
    .values({ name: `KS ${randomUUID()}` })
    .returning({ id: restaurants.id })
  restaurantId = r!.id
  createdRestaurantIds.push(restaurantId)
  const [other] = await db
    .insert(restaurants)
    .values({ name: `KS-other ${randomUUID()}` })
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
  const [t] = await db
    .insert(tables)
    .values({ restaurantId, name: 'T1', qrToken: randomUUID() })
    .returning({ id: tables.id })
  const [o] = await db
    .insert(orders)
    .values({ restaurantId, tableId: t!.id })
    .returning({ id: orders.id })
  orderId = o!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable) return
  for (const id of createdRestaurantIds) await db.delete(orders).where(eq(orders.restaurantId, id))
  await db.delete(menuItems).where(eq(menuItems.id, menuItemId))
  await db.delete(categories).where(eq(categories.restaurantId, restaurantId))
  for (const id of createdRestaurantIds) await db.delete(tables).where(eq(tables.restaurantId, id))
  await db.delete(restaurants).where(inArray(restaurants.id, createdRestaurantIds))
}, DB_TIMEOUT_MS)

async function newItem(status: 'PENDING' | 'COOKING' | 'SERVED' = 'PENDING'): Promise<string> {
  const [item] = await db
    .insert(orderItems)
    .values({ orderId, menuItemId, nameSnapshot: 'Pho', unitPrice: 50000, quantity: 1, status })
    .returning({ id: orderItems.id })
  return item!.id
}

describe('advanceItemStatus', () => {
  it(
    'advances PENDING → COOKING and returns the new status',
    async () => {
      if (!schemaAvailable) return
      const id = await newItem('PENDING')
      const result = await advanceItemStatus(db, restaurantId, id, 'COOKING')
      expect(result).toEqual({ id, status: 'COOKING' })
      const [row] = await db
        .select({ status: orderItems.status })
        .from(orderItems)
        .where(eq(orderItems.id, id))
      expect(row!.status).toBe('COOKING')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects an illegal transition (PENDING → SERVED) with INVALID_TRANSITION',
    async () => {
      if (!schemaAvailable) return
      const id = await newItem('PENDING')
      let code: string | undefined
      try {
        await advanceItemStatus(db, restaurantId, id, 'SERVED')
      } catch (e) {
        code = (e as AppError).code
      }
      expect(code).toBe('INVALID_TRANSITION')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects an item from another restaurant with NOT_FOUND',
    async () => {
      if (!schemaAvailable) return
      const id = await newItem('PENDING')
      let code: string | undefined
      try {
        await advanceItemStatus(db, otherRestaurantId, id, 'COOKING')
      } catch (e) {
        code = (e as AppError).code
      }
      expect(code).toBe('NOT_FOUND')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects an unknown item id with NOT_FOUND',
    async () => {
      if (!schemaAvailable) return
      let code: string | undefined
      try {
        await advanceItemStatus(db, restaurantId, randomUUID(), 'COOKING')
      } catch (e) {
        code = (e as AppError).code
      }
      expect(code).toBe('NOT_FOUND')
    },
    DB_TIMEOUT_MS,
  )
})
