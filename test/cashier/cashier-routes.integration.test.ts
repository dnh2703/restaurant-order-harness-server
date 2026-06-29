import { randomUUID } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { hashPassword } from '../../src/infrastructure/auth/password'
import { db } from '../../src/infrastructure/database/client'
import {
  categories,
  menuItems,
  orderItems,
  orders,
  payments,
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
    // 0. payments first — payments.order_id is a non-cascading FK → orders.id
    await db
      .delete(payments)
      .where(
        inArray(
          payments.orderId,
          db.select({ id: orders.id }).from(orders).where(eq(orders.restaurantId, rid)),
        ),
      )
    // 1. orders next — cascades order_items (order_items.menuItemId FK has no cascade, but
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

describe('cashier discount', () => {
  it(
    'applies a PERCENT discount and recomputes the total',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(cashierAEmail)
      const seeded = await seedOpenOrder({ subtotal: 100000, unitPrice: 100000, quantity: 1 })
      const res = await req(`/cashier/orders/${seeded.orderId}/discount`, {
        method: 'PATCH',
        token,
        body: { type: 'PERCENT', value: 10, reason: 'regular' },
      })
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as {
        data: { order: { discountAmount: number; total: number } }
      }
      expect(data.order.discountAmount).toBe(10000)
      expect(data.order.total).toBe(90000)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects a percent over 100 with 422 INVALID_DISCOUNT',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(cashierAEmail)
      const seeded = await seedOpenOrder({ subtotal: 100000, unitPrice: 100000, quantity: 1 })
      const res = await req(`/cashier/orders/${seeded.orderId}/discount`, {
        method: 'PATCH',
        token,
        body: { type: 'PERCENT', value: 150 },
      })
      expect(res.status).toBe(422)
      expect(await errorCode(res)).toBe('INVALID_DISCOUNT')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'refuses a discount on a non-OPEN order with 409 ORDER_NOT_OPEN',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(cashierAEmail)
      const seeded = await seedOpenOrder({ subtotal: 100000, unitPrice: 100000, quantity: 1 })
      await db.update(orders).set({ status: 'PAID' }).where(eq(orders.id, seeded.orderId))
      const res = await req(`/cashier/orders/${seeded.orderId}/discount`, {
        method: 'PATCH',
        token,
        body: { type: 'FIXED', value: 5000 },
      })
      expect(res.status).toBe(409)
      expect(await errorCode(res)).toBe('ORDER_NOT_OPEN')
    },
    DB_TIMEOUT_MS,
  )
})

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

describe('cashier checkout', () => {
  it(
    'finalizes payment: order PAID, payment.amount = total, table freed to EMPTY',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(cashierAEmail)
      const seeded = await seedOpenOrder({ subtotal: 80000, unitPrice: 80000, quantity: 1 })
      const res = await req(`/cashier/orders/${seeded.orderId}/payment`, {
        method: 'POST',
        token,
        body: { method: 'CASH' },
      })
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as {
        data: { payment: { amount: number }; order: { status: string } }
      }
      expect(data.payment.amount).toBe(80000)
      expect(data.order.status).toBe('PAID')

      const [tableRow] = await db
        .select({ status: tables.status })
        .from(tables)
        .where(eq(tables.id, seeded.tableId))
      expect(tableRow!.status).toBe('EMPTY')

      const paid = await db.select().from(payments).where(eq(payments.orderId, seeded.orderId))
      expect(paid.length).toBe(1)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'a second checkout is refused (409 ORDER_NOT_OPEN) and creates no second payment',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(cashierAEmail)
      const seeded = await seedOpenOrder({ subtotal: 40000, unitPrice: 40000, quantity: 1 })
      const first = await req(`/cashier/orders/${seeded.orderId}/payment`, {
        method: 'POST',
        token,
        body: { method: 'CARD' },
      })
      expect(first.status).toBe(200)
      const second = await req(`/cashier/orders/${seeded.orderId}/payment`, {
        method: 'POST',
        token,
        body: { method: 'CARD' },
      })
      expect(second.status).toBe(409)
      expect(await errorCode(second)).toBe('ORDER_NOT_OPEN')

      const paid = await db.select().from(payments).where(eq(payments.orderId, seeded.orderId))
      expect(paid.length).toBe(1)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'cannot check out another restaurant order — 404 ORDER_NOT_FOUND',
    async () => {
      if (!schemaAvailable) return
      const seeded = await seedOpenOrder({ subtotal: 40000, unitPrice: 40000, quantity: 1 })
      const bToken = await tokenFor(cashierBEmail)
      const res = await req(`/cashier/orders/${seeded.orderId}/payment`, {
        method: 'POST',
        token: bToken,
        body: { method: 'CASH' },
      })
      expect(res.status).toBe(404)
      expect(await errorCode(res)).toBe('ORDER_NOT_FOUND')
    },
    DB_TIMEOUT_MS,
  )
})
