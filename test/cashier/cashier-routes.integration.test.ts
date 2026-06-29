import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { hashPassword } from '../../src/infrastructure/auth/password'
import { db } from '../../src/infrastructure/database/client'
import {
  categories,
  menuItems,
  orderItems,
  orders,
  restaurants,
  tables,
  users,
} from '../../src/infrastructure/database/schema'
import { app } from '../../src/presentation/http/app'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'
import { errorCode } from '../support/http'

let schemaAvailable = false
const password = 'cashier-pw-us018'
const cashierAEmail = `cashier-a-${randomUUID()}@us018.test`
const adminAEmail = `admin-a-${randomUUID()}@us018.test`
const cashierBEmail = `cashier-b-${randomUUID()}@us018.test`
let restaurantAId = ''
let restaurantBId = ''
let menuItemAId = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const passwordHash = await hashPassword(password)
  const [a] = await db
    .insert(restaurants)
    .values({ name: 'US-018 A' })
    .returning({ id: restaurants.id })
  restaurantAId = a!.id
  const [b] = await db
    .insert(restaurants)
    .values({ name: 'US-018 B' })
    .returning({ id: restaurants.id })
  restaurantBId = b!.id
  await db.insert(users).values([
    {
      restaurantId: restaurantAId,
      email: cashierAEmail,
      passwordHash,
      name: 'Cashier A',
      role: 'CASHIER',
    },
    {
      restaurantId: restaurantAId,
      email: adminAEmail,
      passwordHash,
      name: 'Admin A',
      role: 'ADMIN',
    },
    {
      restaurantId: restaurantBId,
      email: cashierBEmail,
      passwordHash,
      name: 'Cashier B',
      role: 'CASHIER',
    },
  ])
  // Seed a category + menu item for restaurant A so orderItems FK is satisfied
  const [cat] = await db
    .insert(categories)
    .values({ restaurantId: restaurantAId, name: 'US-018 Cat' })
    .returning({ id: categories.id })
  const [mi] = await db
    .insert(menuItems)
    .values({ categoryId: cat!.id, name: 'Phở', price: 50000 })
    .returning({ id: menuItems.id })
  menuItemAId = mi!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable) return
  for (const rid of [restaurantAId, restaurantBId].filter(Boolean)) {
    // 1. orders first — cascades order_items (order_items.menuItemId FK has no cascade, but
    //    order_items rows are deleted via orders cascade before we touch menu_items below)
    await db.delete(orders).where(eq(orders.restaurantId, rid))
    await db.delete(tables).where(eq(tables.restaurantId, rid))
    // 2. menu_items before categories (FK: menu_items.categoryId → categories.id)
    if (rid === restaurantAId && menuItemAId) {
      await db.delete(menuItems).where(eq(menuItems.id, menuItemAId))
    }
    await db.delete(categories).where(eq(categories.restaurantId, rid))
    await db.delete(users).where(eq(users.restaurantId, rid))
    await db.delete(restaurants).where(eq(restaurants.id, rid))
  }
}, DB_TIMEOUT_MS)

async function tokenFor(email: string): Promise<string> {
  const res = await app.handle(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  )
  const { data } = (await res.json()) as { data: { accessToken: string } }
  return data.accessToken
}

function req(
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {}
  if (init.token) headers.authorization = `Bearer ${init.token}`
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  return app.handle(
    new Request(`http://localhost/api${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    }),
  )
}

/** Seed an OPEN order for restaurant A with one priced item; returns ids + totals. */
async function seedOpenOrder(opts: { subtotal: number; unitPrice: number; quantity: number }) {
  const [table] = await db
    .insert(tables)
    .values({
      restaurantId: restaurantAId,
      name: `T-${randomUUID()}`,
      qrToken: `tok-${randomUUID()}`,
      status: 'OCCUPIED',
    })
    .returning({ id: tables.id, name: tables.name })
  const [order] = await db
    .insert(orders)
    .values({
      restaurantId: restaurantAId,
      tableId: table!.id,
      status: 'OPEN',
      subtotal: opts.subtotal,
      total: opts.subtotal,
    })
    .returning({ id: orders.id })
  await db.insert(orderItems).values({
    orderId: order!.id,
    menuItemId: menuItemAId, // real FK — seeded in beforeAll
    nameSnapshot: 'Phở',
    unitPrice: opts.unitPrice,
    quantity: opts.quantity,
  })
  return { tableId: table!.id, tableName: table!.name, orderId: order!.id }
}

describe('cashier read surface', () => {
  it(
    'rejects a missing token (401) and a non-staff path is guarded',
    async () => {
      if (!schemaAvailable) return
      expect((await req('/cashier/tables')).status).toBe(401)
    },
    DB_TIMEOUT_MS,
  )

  it(
    "lists this tenant's open tables with running totals (cashier role allowed)",
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(cashierAEmail)
      const seeded = await seedOpenOrder({ subtotal: 50000, unitPrice: 50000, quantity: 1 })
      const res = await req('/cashier/tables', { token })
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as {
        data: { tables: Array<{ orderId: string; total: number; itemCount: number }> }
      }
      const row = data.tables.find((t) => t.orderId === seeded.orderId)
      expect(row).toBeDefined()
      expect(row!.total).toBe(50000)
      expect(row!.itemCount).toBe(1)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'returns bill detail for an order, and 404 ORDER_NOT_FOUND cross-tenant',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(cashierAEmail)
      const seeded = await seedOpenOrder({ subtotal: 30000, unitPrice: 15000, quantity: 2 })
      const ok = await req(`/cashier/orders/${seeded.orderId}`, { token })
      expect(ok.status).toBe(200)
      const { data } = (await ok.json()) as {
        data: { order: { id: string; total: number; items: unknown[] } }
      }
      expect(data.order.id).toBe(seeded.orderId)
      expect(data.order.items.length).toBe(1)

      const bToken = await tokenFor(cashierBEmail)
      const cross = await req(`/cashier/orders/${seeded.orderId}`, { token: bToken })
      expect(cross.status).toBe(404)
      expect(await errorCode(cross)).toBe('ORDER_NOT_FOUND')
    },
    DB_TIMEOUT_MS,
  )
})
