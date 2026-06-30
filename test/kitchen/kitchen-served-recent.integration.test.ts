import { randomUUID } from 'node:crypto'

import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { advanceItemStatus } from '../../src/application/kitchen/advance-item-status'
import { getServedRecent } from '../../src/application/kitchen/get-served-recent'
import { signAccessToken } from '../../src/infrastructure/auth/access-token'
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
import { app } from '../../src/presentation/http/app'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'
import { errorCode } from '../support/http'

let schemaAvailable = false
let restaurantId = ''
let otherRestaurantId = ''
let menuItemId = ''
let orderId = ''
let otherOrderId = ''
let kitchenToken = ''
let cashierToken = ''
const createdRestaurantIds: string[] = []

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const [r] = await db
    .insert(restaurants)
    .values({ name: `KSR ${randomUUID()}` })
    .returning({ id: restaurants.id })
  restaurantId = r!.id
  createdRestaurantIds.push(restaurantId)
  const [other] = await db
    .insert(restaurants)
    .values({ name: `KSR-other ${randomUUID()}` })
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
    .values({ restaurantId, name: 'Table 5', qrToken: randomUUID() })
    .returning({ id: tables.id })
  const [o] = await db
    .insert(orders)
    .values({ restaurantId, tableId: t!.id })
    .returning({ id: orders.id })
  orderId = o!.id

  // A separate restaurant + order to prove tenant scoping.
  const [ot] = await db
    .insert(tables)
    .values({ restaurantId: otherRestaurantId, name: 'Other T1', qrToken: randomUUID() })
    .returning({ id: tables.id })
  const [oo] = await db
    .insert(orders)
    .values({ restaurantId: otherRestaurantId, tableId: ot!.id })
    .returning({ id: orders.id })
  otherOrderId = oo!.id

  kitchenToken = await signAccessToken({ userId: randomUUID(), role: 'KITCHEN', restaurantId })
  cashierToken = await signAccessToken({ userId: randomUUID(), role: 'CASHIER', restaurantId })
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable) return
  for (const id of createdRestaurantIds) await db.delete(orders).where(eq(orders.restaurantId, id))
  await db.delete(menuItems).where(eq(menuItems.id, menuItemId))
  await db.delete(categories).where(eq(categories.restaurantId, restaurantId))
  for (const id of createdRestaurantIds) await db.delete(tables).where(eq(tables.restaurantId, id))
  await db.delete(restaurants).where(inArray(restaurants.id, createdRestaurantIds))
}, DB_TIMEOUT_MS)

/** Insert a SERVED item whose served_at is `minutesAgo` in the past (DB clock). */
async function servedItem(minutesAgo: number, targetOrderId = orderId): Promise<string> {
  const [item] = await db
    .insert(orderItems)
    .values({
      orderId: targetOrderId,
      menuItemId,
      nameSnapshot: 'Pho',
      unitPrice: 50000,
      quantity: 1,
      status: 'SERVED',
      servedAt: sql`now() - ${`${minutesAgo} minutes`}::interval`,
    })
    .returning({ id: orderItems.id })
  return item!.id
}

describe('getServedRecent', () => {
  it(
    'returns SERVED items from the last 30 min, newest first, scoped + windowed + capped',
    async () => {
      if (!schemaAvailable) return

      const recent = await servedItem(2)
      const older = await servedItem(20)
      await db
        .insert(orderItemOptions)
        .values({ orderItemId: recent, optionName: 'Large', priceDelta: 10000 })

      // Excluded: served > 30 min ago, never served (PENDING), and another restaurant's item.
      await servedItem(45)
      await db.insert(orderItems).values({
        orderId,
        menuItemId,
        nameSnapshot: 'Pho',
        unitPrice: 50000,
        quantity: 1,
        status: 'PENDING',
      })
      await servedItem(1, otherOrderId)

      const list = await getServedRecent(db, restaurantId)
      const ids = list.map((i) => i.id)

      expect(ids).toContain(recent)
      expect(ids).toContain(older)
      expect(list.every((i) => i.status === 'SERVED')).toBe(true)
      // newest first: recent (2m) before older (20m)
      expect(ids.indexOf(recent)).toBeLessThan(ids.indexOf(older))
      // servedAt is the sort key and strictly descending
      const times = list.map((i) => i.servedAt)
      expect(times.toSorted().toReversed()).toEqual(times)

      const recentCard = list.find((i) => i.id === recent)!
      expect(recentCard.tableName).toBe('Table 5')
      expect(recentCard.options).toEqual([{ optionName: 'Large', priceDelta: 10000 }])
    },
    DB_TIMEOUT_MS,
  )

  it(
    'caps the list at 50 items',
    async () => {
      if (!schemaAvailable) return
      // 55 items served within the window — the cap must hold.
      const rows = Array.from({ length: 55 }, () => ({
        orderId,
        menuItemId,
        nameSnapshot: 'Pho',
        unitPrice: 50000,
        quantity: 1,
        status: 'SERVED' as const,
        servedAt: sql`now() - interval '5 minutes'`,
      }))
      await db.insert(orderItems).values(rows)
      const list = await getServedRecent(db, restaurantId)
      expect(list.length).toBe(50)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'returns an empty array for a restaurant with nothing served',
    async () => {
      if (!schemaAvailable) return
      expect(await getServedRecent(db, randomUUID())).toEqual([])
    },
    DB_TIMEOUT_MS,
  )
})

describe('advanceItemStatus served_at stamping', () => {
  it(
    'stamps served_at on the →SERVED step and leaves it null before then',
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
      const id = item!.id

      await advanceItemStatus(db, restaurantId, id, 'COOKING')
      const [cooking] = await db
        .select({ servedAt: orderItems.servedAt })
        .from(orderItems)
        .where(eq(orderItems.id, id))
      expect(cooking!.servedAt).toBeNull()

      await advanceItemStatus(db, restaurantId, id, 'SERVED')
      const [served] = await db
        .select({ servedAt: orderItems.servedAt })
        .from(orderItems)
        .where(eq(orderItems.id, id))
      expect(served!.servedAt).not.toBeNull()
    },
    DB_TIMEOUT_MS,
  )
})

describe('GET /kitchen/served-recent route', () => {
  it(
    'returns the list for a KITCHEN token',
    async () => {
      if (!schemaAvailable) return
      const res = await app.handle(
        new Request('http://localhost/api/kitchen/served-recent', {
          headers: { authorization: `Bearer ${kitchenToken}` },
        }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { items: { status: string }[] } }
      expect(Array.isArray(body.data.items)).toBe(true)
      expect(body.data.items.every((i) => i.status === 'SERVED')).toBe(true)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'forbids a CASHIER token (403 FORBIDDEN)',
    async () => {
      if (!schemaAvailable) return
      const res = await app.handle(
        new Request('http://localhost/api/kitchen/served-recent', {
          headers: { authorization: `Bearer ${cashierToken}` },
        }),
      )
      expect(res.status).toBe(403)
      expect(await errorCode(res)).toBe('FORBIDDEN')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'requires auth (401 without a token)',
    async () => {
      if (!schemaAvailable) return
      const res = await app.handle(new Request('http://localhost/api/kitchen/served-recent'))
      expect(res.status).toBe(401)
    },
    DB_TIMEOUT_MS,
  )
})
