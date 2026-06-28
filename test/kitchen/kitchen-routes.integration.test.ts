import { randomUUID } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { signAccessToken } from '../../src/infrastructure/auth/access-token'
import { db } from '../../src/infrastructure/database/client'
import {
  categories,
  menuItems,
  orderItems,
  orders,
  restaurants,
  tables,
} from '../../src/infrastructure/database/schema'
import { app } from '../../src/presentation/http/app'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'
import { errorCode } from '../support/http'

let schemaAvailable = false
let restaurantId = ''
let menuItemId = ''
let orderId = ''
let kitchenToken = ''
let cashierToken = ''
const createdRestaurantIds: string[] = []

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const [r] = await db
    .insert(restaurants)
    .values({ name: `KR ${randomUUID()}` })
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
    .values({ restaurantId, name: 'T1', qrToken: randomUUID() })
    .returning({ id: tables.id })
  const [o] = await db
    .insert(orders)
    .values({ restaurantId, tableId: t!.id })
    .returning({ id: orders.id })
  orderId = o!.id
  kitchenToken = await signAccessToken({ userId: randomUUID(), role: 'KITCHEN', restaurantId })
  cashierToken = await signAccessToken({ userId: randomUUID(), role: 'CASHIER', restaurantId })
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable) return
  await db.delete(orders).where(eq(orders.restaurantId, restaurantId))
  await db.delete(menuItems).where(eq(menuItems.id, menuItemId))
  await db.delete(categories).where(eq(categories.restaurantId, restaurantId))
  await db.delete(tables).where(eq(tables.restaurantId, restaurantId))
  await db.delete(restaurants).where(inArray(restaurants.id, createdRestaurantIds))
}, DB_TIMEOUT_MS)

function req(path: string, token: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost/api${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  })
}

describe('kitchen routes', () => {
  it(
    'GET /kitchen/queue returns the queue for a KITCHEN token',
    async () => {
      if (!schemaAvailable) return
      await db.insert(orderItems).values({
        orderId,
        menuItemId,
        nameSnapshot: 'Pho',
        unitPrice: 50000,
        quantity: 1,
        status: 'PENDING',
      })
      const res = await app.handle(req('/kitchen/queue', kitchenToken))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { items: { status: string }[] } }
      expect(body.data.items.some((i) => i.status === 'PENDING')).toBe(true)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'forbids a CASHIER token (403 FORBIDDEN)',
    async () => {
      if (!schemaAvailable) return
      const res = await app.handle(req('/kitchen/queue', cashierToken))
      expect(res.status).toBe(403)
      expect(await errorCode(res)).toBe('FORBIDDEN')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'PATCH status advances PENDING→COOKING and rejects an illegal jump (409)',
    async () => {
      if (!schemaAvailable) return
      const [item] = await db
        .insert(orderItems)
        .values({
          orderId,
          menuItemId,
          nameSnapshot: 'Pho',
          unitPrice: 50000,
          quantity: 1,
          status: 'PENDING',
        })
        .returning({ id: orderItems.id })
      const ok = await app.handle(
        req(`/kitchen/order-items/${item!.id}/status`, kitchenToken, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'COOKING' }),
        }),
      )
      expect(ok.status).toBe(200)

      const [item2] = await db
        .insert(orderItems)
        .values({
          orderId,
          menuItemId,
          nameSnapshot: 'Pho',
          unitPrice: 50000,
          quantity: 1,
          status: 'PENDING',
        })
        .returning({ id: orderItems.id })
      const bad = await app.handle(
        req(`/kitchen/order-items/${item2!.id}/status`, kitchenToken, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'SERVED' }),
        }),
      )
      expect(bad.status).toBe(409)
      expect(await errorCode(bad)).toBe('INVALID_TRANSITION')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'PATCH availability toggles sold-out for a KITCHEN token',
    async () => {
      if (!schemaAvailable) return
      const res = await app.handle(
        req(`/kitchen/menu-items/${menuItemId}/availability`, kitchenToken, {
          method: 'PATCH',
          body: JSON.stringify({ isAvailable: false }),
        }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { item: { isAvailable: boolean } } }
      expect(body.data.item.isAvailable).toBe(false)
      await db.update(menuItems).set({ isAvailable: true }).where(eq(menuItems.id, menuItemId))
    },
    DB_TIMEOUT_MS,
  )

  it(
    'requires auth (401 without a token)',
    async () => {
      if (!schemaAvailable) return
      const res = await app.handle(new Request('http://localhost/api/kitchen/queue'))
      expect(res.status).toBe(401)
    },
    DB_TIMEOUT_MS,
  )
})
