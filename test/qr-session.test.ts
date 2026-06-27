import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'

import { db } from '../src/infrastructure/database/client'
import { orders, restaurants, tables } from '../src/infrastructure/database/schema'
import { app } from '../src/presentation/http/app'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from './support/db'

/**
 * Integration proof for US-005 (QR resolve table + open order session). Drives the
 * public `GET /api/qr/:qrToken` route through `app.handle(...)` and inspects the DB to
 * assert the resolve-or-create invariants.
 *
 * Requires a migrated DATABASE_URL (a Neon branch); self-skips otherwise (see ./support/db).
 * Each test unwinds the rows it created (orders → tables → restaurants) in afterEach.
 */
let schemaAvailable = false

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
}, WARMUP_TIMEOUT_MS)

const createdRestaurantIds: string[] = []

async function makeTable(qrToken: string): Promise<{ restaurantId: string; tableId: string }> {
  const [restaurant] = await db
    .insert(restaurants)
    .values({ name: 'QR Session Test Co' })
    .returning({ id: restaurants.id })
  createdRestaurantIds.push(restaurant!.id)
  const [table] = await db
    .insert(tables)
    .values({ restaurantId: restaurant!.id, name: 'Table 7', qrToken })
    .returning({ id: tables.id })
  return { restaurantId: restaurant!.id, tableId: table!.id }
}

async function openOrders(tableId: string) {
  return db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.tableId, tableId), eq(orders.status, 'OPEN')))
}

afterEach(async () => {
  for (const restaurantId of createdRestaurantIds.splice(0)) {
    await db.delete(orders).where(eq(orders.restaurantId, restaurantId))
    await db.delete(tables).where(eq(tables.restaurantId, restaurantId))
    await db.delete(restaurants).where(eq(restaurants.id, restaurantId))
  }
}, DB_TIMEOUT_MS)

function resolve(qrToken: string): Promise<Response> {
  return app.handle(new Request(`http://localhost/api/qr/${qrToken}`))
}

describe('GET /api/qr/:qrToken', () => {
  it(
    'returns 404 INVALID_TABLE for an unknown token',
    async () => {
      if (!schemaAvailable) return

      const res = await resolve(`unknown-${randomUUID()}`)
      const body = (await res.json()) as { error?: { code: string } }

      expect(res.status).toBe(404)
      expect(body.error?.code).toBe('INVALID_TABLE')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'creates an OPEN order and marks the table OCCUPIED on first scan',
    async () => {
      if (!schemaAvailable) return

      const qrToken = `valid-${randomUUID()}`
      const { tableId } = await makeTable(qrToken)

      const res = await resolve(qrToken)
      const body = (await res.json()) as {
        data?: {
          restaurant: { name: string }
          table: { id: string; name: string; status: string }
          session: { orderId: string; status: string; openedAt: string }
        }
      }

      expect(res.status).toBe(200)
      expect(body.data?.restaurant.name).toBe('QR Session Test Co')
      expect(body.data?.table.name).toBe('Table 7')
      expect(body.data?.session.status).toBe('OPEN')
      expect(body.data?.session.orderId).toBeString()

      const [table] = await db
        .select({ status: tables.status })
        .from(tables)
        .where(eq(tables.id, tableId))
      expect(table?.status).toBe('OCCUPIED')

      const open = await openOrders(tableId)
      expect(open).toHaveLength(1)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'reuses the same OPEN order on a second scan',
    async () => {
      if (!schemaAvailable) return

      const qrToken = `reuse-${randomUUID()}`
      const { tableId } = await makeTable(qrToken)

      const first = (await (await resolve(qrToken)).json()) as {
        data?: { session: { orderId: string } }
      }
      const second = (await (await resolve(qrToken)).json()) as {
        data?: { session: { orderId: string } }
      }

      expect(second.data?.session.orderId).toBe(first.data?.session.orderId)
      const open = await openOrders(tableId)
      expect(open).toHaveLength(1)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'does not create two OPEN orders under concurrent scans',
    async () => {
      if (!schemaAvailable) return

      const qrToken = `concurrent-${randomUUID()}`
      const { tableId } = await makeTable(qrToken)

      const responses = await Promise.all([resolve(qrToken), resolve(qrToken), resolve(qrToken)])
      for (const res of responses) expect(res.status).toBe(200)

      const open = await openOrders(tableId)
      expect(open).toHaveLength(1)
    },
    DB_TIMEOUT_MS,
  )
})
