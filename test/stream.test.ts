import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'

import { db } from '../src/infrastructure/database/client'
import { broker } from '../src/infrastructure/realtime/realtime-broker'
import { orders, restaurants, tables } from '../src/infrastructure/database/schema'
import { app } from '../src/presentation/http/app'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from './support/db'

let schemaAvailable = false
beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
}, WARMUP_TIMEOUT_MS)

const createdRestaurantIds: string[] = []

async function makeOpenOrder(qrToken: string): Promise<string> {
  const [restaurant] = await db
    .insert(restaurants)
    .values({ name: 'Stream Test Co' })
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

describe('GET /api/qr/:qrToken/stream', () => {
  it(
    'returns 404 for an unknown qrToken',
    async () => {
      if (!schemaAvailable) return
      const res = await app.handle(new Request(`http://localhost/api/qr/${randomUUID()}/stream`))
      expect(res.status).toBe(404)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'streams an order_item.updated event over text/event-stream',
    async () => {
      if (!schemaAvailable) return
      const qrToken = randomUUID()
      const orderId = await makeOpenOrder(qrToken)

      // In Bun, app.handle() with an SSE generator blocks until the generator yields
      // its first value. We must not await it before publishing, or the generator
      // will wait 20 s for the keep-alive before handle() returns. Start the request
      // first, let the handler subscribe during the sleep, then publish.
      // The generator's first action is resolveOrderId (a DB round-trip that can take
      // ~200–300 ms even on a warm Neon pool); use a generous sleep to cover that.
      const resPromise = app.handle(new Request(`http://localhost/api/qr/${qrToken}/stream`))
      // Let the handler subscribe before we publish (DB round-trip can take ~200 ms).
      await Bun.sleep(1_000)
      broker.publish(
        JSON.stringify({
          type: 'order_item',
          orderId,
          orderItemId: 'i1',
          status: 'COOKING',
          op: 'UPDATE',
        }),
      )
      const res = await resPromise
      expect(res.headers.get('content-type')).toContain('text/event-stream')

      const reader = res.body!.getReader()
      const { value } = await reader.read()
      // Bun+Elysia SSE yields strings, not Uint8Array.
      const text = value as string
      expect(text).toContain('order_item.updated')
      expect(text).toContain('COOKING')
      await reader.cancel()
    },
    DB_TIMEOUT_MS,
  )
})
