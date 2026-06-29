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
// Track created menu_items rows for FK-safe teardown.
const createdMenuItemIds: string[] = []
const menuItemIdByName = new Map<string, string>()

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
 * Seed a PAID order: a table, a PAID order, one priced item, and a payment at `paidAt`.
 * Returns the order id. `restaurantId` defaults to A. The menu item is looked up by name so
 * repeat orders of the same dish share one menu_item_id — matching how top-dishes'
 * group-by-menu_item_id aggregates them. The menu item is created under restaurant A's category
 * in all cases — top-dishes scopes by `orders.restaurant_id` (the orders join), not the item's
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
  // Same dish name → same menu_item_id (real orders of a dish share one menu item). This is
  // what lets top-dishes' group-by-menu_item_id aggregate repeat orders into one ranked row.
  let menuItemId = menuItemIdByName.get(name)
  if (menuItemId === undefined) {
    const [mi] = await db
      .insert(menuItems)
      .values({ categoryId: categoryAId, name, price: opts.unitPrice })
      .returning({ id: menuItems.id })
    menuItemId = mi!.id
    createdMenuItemIds.push(menuItemId)
    menuItemIdByName.set(name, menuItemId)
  }
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
    menuItemId,
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

describe('reports top-dishes', () => {
  it(
    'ranks dishes by quantity (tiebreak revenue), honoring limit and excluding cancelled lines',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const day = new Date('2026-05-05T05:00:00Z') // 2026-05-05 local
      // Phở bò: 3 + 4 = 7 sold. Cà phê: 5 sold. Trà đá: 2 sold. Bún: cancelled (excluded).
      await seedPaidOrder({
        paidAt: day,
        unitPrice: 70000,
        quantity: 3,
        amount: 210000,
        nameSnapshot: 'Phở bò',
      })
      await seedPaidOrder({
        paidAt: day,
        unitPrice: 70000,
        quantity: 4,
        amount: 280000,
        nameSnapshot: 'Phở bò',
      })
      await seedPaidOrder({
        paidAt: day,
        unitPrice: 25000,
        quantity: 5,
        amount: 125000,
        nameSnapshot: 'Cà phê',
      })
      await seedPaidOrder({
        paidAt: day,
        unitPrice: 10000,
        quantity: 2,
        amount: 20000,
        nameSnapshot: 'Trà đá',
      })
      await seedPaidOrder({
        paidAt: day,
        unitPrice: 99000,
        quantity: 9,
        amount: 0,
        itemStatus: 'CANCELLED',
        nameSnapshot: 'Bún',
      })

      const res = await req('/reports/top-dishes?from=2026-05-05&to=2026-05-05&limit=2', { token })
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as {
        data: { dishes: { name: string; quantitySold: number; revenue: number }[] }
      }
      expect(data.dishes).toHaveLength(2)
      expect(data.dishes[0]).toMatchObject({ name: 'Phở bò', quantitySold: 7, revenue: 490000 })
      expect(data.dishes[1]).toMatchObject({ name: 'Cà phê', quantitySold: 5, revenue: 125000 })
      // 'Bún' (cancelled) and 'Trà đá' (rank 3, beyond limit) are absent.
      expect(data.dishes.some((d) => d.name === 'Bún')).toBe(false)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'defaults limit to 10 and isolates by tenant',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const day = new Date('2026-05-20T05:00:00Z')
      await seedPaidOrder({
        paidAt: day,
        unitPrice: 30000,
        quantity: 6,
        amount: 180000,
        nameSnapshot: 'Mì Quảng',
      })
      // Cross-tenant dish must not appear for admin A.
      await seedPaidOrder({
        restaurantId: restaurantBId,
        paidAt: day,
        unitPrice: 30000,
        quantity: 99,
        amount: 2970000,
        nameSnapshot: 'B-only',
      })

      const res = await req('/reports/top-dishes?from=2026-05-20&to=2026-05-20', { token })
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as { data: { dishes: { name: string }[] } }
      expect(data.dishes.some((d) => d.name === 'Mì Quảng')).toBe(true)
      expect(data.dishes.some((d) => d.name === 'B-only')).toBe(false)
    },
    DB_TIMEOUT_MS,
  )
})

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
      await db.insert(orders).values({
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
