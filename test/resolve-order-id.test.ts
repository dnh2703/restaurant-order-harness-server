import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'

import { resolveOrderId } from '../src/application/orders/resolve-order-id'
import { db } from '../src/infrastructure/database/client'
import { orders, restaurants, tables } from '../src/infrastructure/database/schema'
import { AppError } from '../src/shared/errors'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from './support/db'

let schemaAvailable = false
beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
}, WARMUP_TIMEOUT_MS)

const createdRestaurantIds: string[] = []

async function makeOpenOrder(qrToken: string): Promise<string> {
  const [restaurant] = await db
    .insert(restaurants)
    .values({ name: 'Resolve OrderId Test Co' })
    .returning({ id: restaurants.id })
  createdRestaurantIds.push(restaurant!.id)
  const [table] = await db
    .insert(tables)
    .values({ restaurantId: restaurant!.id, name: 'T1', qrToken })
    .returning({ id: tables.id })
  const [order] = await db
    .insert(orders)
    .values({ restaurantId: restaurant!.id, tableId: table!.id })
    .returning({ id: orders.id })
  return order!.id
}

afterEach(async () => {
  for (const restaurantId of createdRestaurantIds.splice(0)) {
    await db.delete(orders).where(eq(orders.restaurantId, restaurantId))
    await db.delete(tables).where(eq(tables.restaurantId, restaurantId))
    await db.delete(restaurants).where(eq(restaurants.id, restaurantId))
  }
}, DB_TIMEOUT_MS)

describe('resolveOrderId', () => {
  it(
    'returns the OPEN order id for a valid qrToken',
    async () => {
      if (!schemaAvailable) return
      const qrToken = randomUUID()
      const expected = await makeOpenOrder(qrToken)
      const orderId = await resolveOrderId(db, qrToken)
      expect(orderId).toBe(expected)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws INVALID_TABLE for an unknown qrToken',
    async () => {
      if (!schemaAvailable) return
      await expect(resolveOrderId(db, randomUUID())).rejects.toBeInstanceOf(AppError)
    },
    DB_TIMEOUT_MS,
  )
})
