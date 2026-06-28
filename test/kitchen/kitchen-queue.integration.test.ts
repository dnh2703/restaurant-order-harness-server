import { randomUUID } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { getKitchenQueue } from '../../src/application/kitchen/get-queue'
import { db } from '../../src/infrastructure/database/client'
import {
  categories,
  menuItems,
  orderItemOptions,
  orderItems,
  orders,
  restaurants,
  tables,
} from '../../src/infrastructure/database/schema'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'

let schemaAvailable = false
let restaurantId = ''
let orderId = ''
let menuItemId = ''
const createdRestaurantIds: string[] = []

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const [r] = await db
    .insert(restaurants)
    .values({ name: `KQ ${randomUUID()}` })
    .returning({ id: restaurants.id })
  restaurantId = r!.id
  createdRestaurantIds.push(restaurantId)
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
    .values({ restaurantId, name: 'Table 5', qrToken: randomUUID() })
    .returning({ id: tables.id })
  const [o] = await db
    .insert(orders)
    .values({ restaurantId, tableId: t!.id })
    .returning({ id: orders.id })
  orderId = o!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable) return
  await db.delete(orders).where(eq(orders.restaurantId, restaurantId))
  await db.delete(menuItems).where(eq(menuItems.id, menuItemId))
  await db.delete(categories).where(eq(categories.restaurantId, restaurantId))
  await db.delete(tables).where(eq(tables.restaurantId, restaurantId))
  await db.delete(restaurants).where(inArray(restaurants.id, createdRestaurantIds))
}, DB_TIMEOUT_MS)

describe('getKitchenQueue', () => {
  it(
    'returns only PENDING+COOKING items, oldest first, with table name and options',
    async () => {
      if (!schemaAvailable) return

      const [pending] = await db
        .insert(orderItems)
        .values({
          orderId,
          menuItemId,
          nameSnapshot: 'Pho',
          unitPrice: 50000,
          quantity: 2,
          note: 'no onion',
          status: 'PENDING',
        })
        .returning({ id: orderItems.id })
      await db
        .insert(orderItemOptions)
        .values({ orderItemId: pending!.id, optionName: 'Large', priceDelta: 10000 })

      await db.insert(orderItems).values({
        orderId,
        menuItemId,
        nameSnapshot: 'Pho',
        unitPrice: 50000,
        quantity: 1,
        status: 'COOKING',
      })
      // SERVED + CANCELLED must NOT appear in the queue.
      await db.insert(orderItems).values({
        orderId,
        menuItemId,
        nameSnapshot: 'Pho',
        unitPrice: 50000,
        quantity: 1,
        status: 'SERVED',
      })
      await db.insert(orderItems).values({
        orderId,
        menuItemId,
        nameSnapshot: 'Pho',
        unitPrice: 50000,
        quantity: 1,
        status: 'CANCELLED',
      })

      const queue = await getKitchenQueue(db, restaurantId)
      expect(queue.map((q) => q.status).toSorted()).toEqual(['COOKING', 'PENDING'])
      const pendingCard = queue.find((q) => q.status === 'PENDING')!
      expect(pendingCard.tableName).toBe('Table 5')
      expect(pendingCard.quantity).toBe(2)
      expect(pendingCard.note).toBe('no onion')
      expect(pendingCard.options).toEqual([{ optionName: 'Large', priceDelta: 10000 }])
      // oldest first: createdAt ascending
      const times = queue.map((q) => q.createdAt)
      expect(times.toSorted()).toEqual(times)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'returns an empty array for a restaurant with no active items',
    async () => {
      if (!schemaAvailable) return
      expect(await getKitchenQueue(db, randomUUID())).toEqual([])
    },
    DB_TIMEOUT_MS,
  )
})
