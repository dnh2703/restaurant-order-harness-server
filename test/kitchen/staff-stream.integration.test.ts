import { randomUUID } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { signAccessToken } from '../../src/infrastructure/auth/access-token'
import { db, pool } from '../../src/infrastructure/database/client'
import {
  broker,
  topicForRestaurant,
  type RealtimeEvent,
} from '../../src/infrastructure/realtime/realtime-broker'
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
let brokerStarted = false
let restaurantId = ''
let menuItemId = ''
let orderId = ''
let token = ''
const createdRestaurantIds: string[] = []

async function nextEvent(events: AsyncIterableIterator<RealtimeEvent>, timeoutMs = 5_000) {
  const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), timeoutMs))
  const result = await Promise.race([events.next(), timeout])
  return result && 'value' in result ? result.value : undefined
}

async function waitForBrokerConnected(timeoutMs: number, rid: string): Promise<boolean> {
  const payload = JSON.stringify({
    type: 'order_item',
    restaurantId: rid,
    orderId: '__probe__',
    orderItemId: 'probe',
    status: 'PENDING',
    op: 'INSERT',
  } satisfies RealtimeEvent)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const sub = broker.subscribe(topicForRestaurant(rid))
    try {
      await pool.query('SELECT pg_notify($1, $2)', ['realtime', payload])
      const got = await nextEvent(sub.events, 2_000)
      sub.unsubscribe()
      if (got !== undefined) return true
    } catch {
      sub.unsubscribe()
    }
    await Bun.sleep(500)
  }
  return false
}

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const [r] = await db
    .insert(restaurants)
    .values({ name: `SS ${randomUUID()}` })
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
  token = await signAccessToken({ userId: randomUUID(), role: 'KITCHEN', restaurantId })
  await broker.start()
  brokerStarted = true
  schemaAvailable = await waitForBrokerConnected(30_000, restaurantId)
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (brokerStarted) await broker.stop()
  if (createdRestaurantIds.length === 0) return
  await db.delete(orders).where(eq(orders.restaurantId, restaurantId))
  await db.delete(menuItems).where(eq(menuItems.id, menuItemId))
  await db.delete(categories).where(eq(categories.restaurantId, restaurantId))
  await db.delete(tables).where(eq(tables.restaurantId, restaurantId))
  await db.delete(restaurants).where(inArray(restaurants.id, createdRestaurantIds))
}, DB_TIMEOUT_MS)

describe('staff restaurant-wide SSE', () => {
  it(
    'rejects a :id that does not match the token restaurant (403)',
    async () => {
      if (!schemaAvailable) return
      const res = await app.handle(
        new Request(`http://localhost/api/stream/restaurant/${randomUUID()}`, {
          headers: { authorization: `Bearer ${token}` },
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
      const res = await app.handle(
        new Request(`http://localhost/api/stream/restaurant/${restaurantId}`),
      )
      expect(res.status).toBe(401)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'delivers an order_item event on the restaurant topic when a status changes',
    async () => {
      if (!schemaAvailable) return
      const sub = broker.subscribe(topicForRestaurant(restaurantId))
      try {
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
        await db.update(orderItems).set({ status: 'COOKING' }).where(eq(orderItems.id, item!.id))
        let received: RealtimeEvent | undefined
        for (let i = 0; i < 5; i += 1) {
          received = await nextEvent(sub.events)
          if (received?.status === 'COOKING') break
        }
        expect(received?.status).toBe('COOKING')
        expect(received?.restaurantId).toBe(restaurantId)
      } finally {
        sub.unsubscribe()
      }
    },
    DB_TIMEOUT_MS,
  )
})
