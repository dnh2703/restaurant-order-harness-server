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
const password = 'reports-pw-us019'
const adminAEmail = `admin-a-${randomUUID()}@us019.test`
const cashierAEmail = `cashier-a-${randomUUID()}@us019.test`
const adminBEmail = `admin-b-${randomUUID()}@us019.test`
let restaurantAId = ''
let restaurantBId = ''
let categoryAId = ''
let cashierAId = ''
// Each seedPaidOrder() creates a distinct menu_items row (so top-dishes can group by
// menu_item_id); track them for FK-safe teardown.
const createdMenuItemIds: string[] = []

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const passwordHash = await hashPassword(password)
  const [a] = await db
    .insert(restaurants)
    .values({ name: 'US-019 A' })
    .returning({ id: restaurants.id })
  restaurantAId = a!.id
  const [b] = await db
    .insert(restaurants)
    .values({ name: 'US-019 B' })
    .returning({ id: restaurants.id })
  restaurantBId = b!.id
  const inserted = await db
    .insert(users)
    .values([
      {
        restaurantId: restaurantAId,
        email: adminAEmail,
        passwordHash,
        name: 'Admin A',
        role: 'ADMIN',
      },
      {
        restaurantId: restaurantAId,
        email: cashierAEmail,
        passwordHash,
        name: 'Cashier A',
        role: 'CASHIER',
      },
      {
        restaurantId: restaurantBId,
        email: adminBEmail,
        passwordHash,
        name: 'Admin B',
        role: 'ADMIN',
      },
    ])
    .returning({ id: users.id, email: users.email })
  cashierAId = inserted.find((u) => u.email === cashierAEmail)!.id
  const [cat] = await db
    .insert(categories)
    .values({ restaurantId: restaurantAId, name: 'US-019 Cat' })
    .returning({ id: categories.id })
  categoryAId = cat!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable) return
  // order_items cascade-delete with their order, so deleting orders frees the menu_items FK.
  for (const rid of [restaurantAId, restaurantBId].filter(Boolean)) {
    await db
      .delete(payments)
      .where(
        inArray(
          payments.orderId,
          db.select({ id: orders.id }).from(orders).where(eq(orders.restaurantId, rid)),
        ),
      )
    await db.delete(orders).where(eq(orders.restaurantId, rid))
    await db.delete(tables).where(eq(tables.restaurantId, rid))
  }
  if (createdMenuItemIds.length > 0) {
    await db.delete(menuItems).where(inArray(menuItems.id, createdMenuItemIds))
  }
  await db.delete(categories).where(eq(categories.restaurantId, restaurantAId))
  for (const rid of [restaurantAId, restaurantBId].filter(Boolean)) {
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

function req(path: string, init: { method?: string; token?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {}
  if (init.token) headers.authorization = `Bearer ${init.token}`
  return app.handle(
    new Request(`http://localhost/api${path}`, { method: init.method ?? 'GET', headers }),
  )
}

/**
 * Seed a PAID order: a distinct menu item (so top-dishes can group by menu_item_id), a table,
 * a PAID order, one priced item, and a payment at `paidAt`. Returns the order id.
 * `restaurantId` defaults to A. The menu item is created under restaurant A's category in all
 * cases — top-dishes scopes by `orders.restaurant_id` (the orders join), not the item's
 * category, so a restaurant-B order referencing an A-owned item is still isolated correctly.
 */
async function seedPaidOrder(opts: {
  restaurantId?: string
  paidAt: Date
  unitPrice: number
  quantity: number
  amount: number
  itemStatus?: 'SERVED' | 'CANCELLED'
  nameSnapshot?: string
}) {
  const rid = opts.restaurantId ?? restaurantAId
  const name = opts.nameSnapshot ?? 'Phở bò'
  const [mi] = await db
    .insert(menuItems)
    .values({ categoryId: categoryAId, name, price: opts.unitPrice })
    .returning({ id: menuItems.id })
  createdMenuItemIds.push(mi!.id)
  const [table] = await db
    .insert(tables)
    .values({
      restaurantId: rid,
      name: `T-${randomUUID()}`,
      qrToken: `tok-${randomUUID()}`,
      status: 'EMPTY',
    })
    .returning({ id: tables.id })
  const [order] = await db
    .insert(orders)
    .values({
      restaurantId: rid,
      tableId: table!.id,
      status: 'PAID',
      subtotal: opts.amount,
      total: opts.amount,
      closedAt: opts.paidAt,
    })
    .returning({ id: orders.id })
  await db.insert(orderItems).values({
    orderId: order!.id,
    menuItemId: mi!.id,
    nameSnapshot: name,
    unitPrice: opts.unitPrice,
    quantity: opts.quantity,
    status: opts.itemStatus ?? 'SERVED',
  })
  await db.insert(payments).values({
    orderId: order!.id,
    method: 'CASH',
    amount: opts.amount,
    cashierId: cashierAId,
    paidAt: opts.paidAt,
  })
  return { orderId: order!.id }
}

describe('reports revenue', () => {
  it(
    'sums payments.amount per local day with a range summary, excluding open/cross-tenant',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      // Two payments on 2026-03-10 local, one on 2026-03-11 local (Asia/Ho_Chi_Minh = UTC+7).
      await seedPaidOrder({
        paidAt: new Date('2026-03-10T05:00:00Z'),
        unitPrice: 100000,
        quantity: 1,
        amount: 100000,
      })
      await seedPaidOrder({
        paidAt: new Date('2026-03-10T09:00:00Z'),
        unitPrice: 50000,
        quantity: 1,
        amount: 50000,
      })
      await seedPaidOrder({
        paidAt: new Date('2026-03-11T03:00:00Z'),
        unitPrice: 75000,
        quantity: 1,
        amount: 75000,
      })
      // An OPEN order (no payment) must NOT count.
      const [openTable] = await db
        .insert(tables)
        .values({
          restaurantId: restaurantAId,
          name: `T-${randomUUID()}`,
          qrToken: `tok-${randomUUID()}`,
          status: 'OCCUPIED',
        })
        .returning({ id: tables.id })
      await db
        .insert(orders)
        .values({
          restaurantId: restaurantAId,
          tableId: openTable!.id,
          status: 'OPEN',
          subtotal: 999000,
          total: 999000,
        })
      // A cross-tenant payment (restaurant B) must NOT count.
      await seedPaidOrder({
        restaurantId: restaurantBId,
        paidAt: new Date('2026-03-10T05:00:00Z'),
        unitPrice: 1,
        quantity: 1,
        amount: 1,
      })

      const res = await req('/reports/revenue?from=2026-03-10&to=2026-03-11', { token })
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as {
        data: {
          days: { day: string; revenue: number; orderCount: number }[]
          summary: { from: string; to: string; totalRevenue: number; totalOrders: number }
        }
      }
      expect(data.days).toEqual([
        { day: '2026-03-10', revenue: 150000, orderCount: 2 },
        { day: '2026-03-11', revenue: 75000, orderCount: 1 },
      ])
      expect(data.summary).toEqual({
        from: '2026-03-10',
        to: '2026-03-11',
        totalRevenue: 225000,
        totalOrders: 3,
      })
    },
    DB_TIMEOUT_MS,
  )

  it(
    'counts a late-night payment on its local day, not the UTC day',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      // 2026-04-01 23:30 +07 == 2026-04-01T16:30:00Z. UTC day is 04-01; local day is 04-01.
      // 2026-04-01 18:30Z == 2026-04-02 01:30 +07 → local day 04-02.
      await seedPaidOrder({
        paidAt: new Date('2026-04-01T18:30:00Z'),
        unitPrice: 60000,
        quantity: 1,
        amount: 60000,
      })
      const res = await req('/reports/revenue?from=2026-04-02&to=2026-04-02', { token })
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as {
        data: { days: { day: string; revenue: number; orderCount: number }[] }
      }
      expect(data.days).toEqual([{ day: '2026-04-02', revenue: 60000, orderCount: 1 }])
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects from > to with 422 INVALID_DATE_RANGE',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const res = await req('/reports/revenue?from=2026-03-11&to=2026-03-10', { token })
      expect(res.status).toBe(422)
      expect(await errorCode(res)).toBe('INVALID_DATE_RANGE')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'is ADMIN-only: a CASHIER token gets 403 and no token gets 401',
    async () => {
      if (!schemaAvailable) return
      const cashierToken = await tokenFor(cashierAEmail)
      const forbidden = await req('/reports/revenue?from=2026-03-10&to=2026-03-11', {
        token: cashierToken,
      })
      expect(forbidden.status).toBe(403)
      const unauth = await req('/reports/revenue?from=2026-03-10&to=2026-03-11')
      expect(unauth.status).toBe(401)
    },
    DB_TIMEOUT_MS,
  )
})
