import { randomUUID } from 'node:crypto'

import { and, eq, inArray } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'

import { db } from '../src/infrastructure/database/client'
import {
  categories,
  menuItems,
  optionGroups,
  options,
  orders,
  restaurants,
  tables,
} from '../src/infrastructure/database/schema'
import { app } from '../src/presentation/http/app'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from './support/db'

/**
 * Integration proof for US-007 (add items + submit order). Drives the public
 * `POST /api/qr/:qrToken/order-items` and `GET /api/qr/:qrToken/order` routes through
 * `app.handle(...)` against a seeded menu and asserts: server-authoritative pricing +
 * snapshots, PENDING status, recomputed totals, append-on-resubmit (one OPEN order), and the
 * rejections (unavailable 409; bad quantity / missing required option 422; cross-restaurant
 * item 404).
 *
 * Requires a migrated DATABASE_URL (a Neon branch); self-skips otherwise (see ./support/db).
 */
let schemaAvailable = false

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
}, WARMUP_TIMEOUT_MS)

const createdRestaurantIds: string[] = []

interface SeededMenu {
  qrToken: string
  riceId: string
  optReg: string
  optLarge: string
  optEgg: string
  teaId: string
  phoId: string
}

/**
 * Seed one restaurant with a QR table and three dishes: `Cơm` (available) with a required
 * SINGLE `Size` group [Thường 0, Lớn 10000] and an optional MULTI `Extra` group [Trứng 5000],
 * `Trà đá` (available, no options), and `Phở` (sold out). Returns the ids the tests submit.
 */
async function seedMenu(label: string): Promise<SeededMenu> {
  const qrToken = `order-${label}-${randomUUID()}`
  const [restaurant] = await db
    .insert(restaurants)
    .values({ name: `Order Test Co ${label}` })
    .returning({ id: restaurants.id })
  const restaurantId = restaurant!.id
  createdRestaurantIds.push(restaurantId)

  await db.insert(tables).values({ restaurantId, name: `Table ${label}`, qrToken })

  const [mains] = await db
    .insert(categories)
    .values({ restaurantId, name: `Mains ${label}`, sortOrder: 0 })
    .returning({ id: categories.id })

  const [rice] = await db
    .insert(menuItems)
    .values({ categoryId: mains!.id, name: `Cơm ${label}`, price: 45000 })
    .returning({ id: menuItems.id })
  const [tea] = await db
    .insert(menuItems)
    .values({ categoryId: mains!.id, name: `Trà đá ${label}`, price: 5000 })
    .returning({ id: menuItems.id })
  const [pho] = await db
    .insert(menuItems)
    .values({ categoryId: mains!.id, name: `Phở ${label}`, price: 50000, isAvailable: false })
    .returning({ id: menuItems.id })

  const [size] = await db
    .insert(optionGroups)
    .values({ menuItemId: rice!.id, name: 'Size', type: 'SINGLE', isRequired: true })
    .returning({ id: optionGroups.id })
  const [reg] = await db
    .insert(options)
    .values({ optionGroupId: size!.id, name: 'Thường', priceDelta: 0 })
    .returning({ id: options.id })
  const [large] = await db
    .insert(options)
    .values({ optionGroupId: size!.id, name: 'Lớn', priceDelta: 10000 })
    .returning({ id: options.id })

  const [extra] = await db
    .insert(optionGroups)
    .values({ menuItemId: rice!.id, name: 'Extra', type: 'MULTI', isRequired: false })
    .returning({ id: optionGroups.id })
  const [egg] = await db
    .insert(options)
    .values({ optionGroupId: extra!.id, name: 'Trứng', priceDelta: 5000 })
    .returning({ id: options.id })

  return {
    qrToken,
    riceId: rice!.id,
    optReg: reg!.id,
    optLarge: large!.id,
    optEgg: egg!.id,
    teaId: tea!.id,
    phoId: pho!.id,
  }
}

afterEach(async () => {
  for (const restaurantId of createdRestaurantIds.splice(0)) {
    const tableRows = await db
      .select({ id: tables.id })
      .from(tables)
      .where(eq(tables.restaurantId, restaurantId))
    if (tableRows.length > 0) {
      // Deleting orders cascades to order_items → order_item_options.
      await db.delete(orders).where(
        inArray(
          orders.tableId,
          tableRows.map((t) => t.id),
        ),
      )
    }
    const cats = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.restaurantId, restaurantId))
    if (cats.length > 0) {
      // Deleting menu_items cascades to option_groups → options.
      await db.delete(menuItems).where(
        inArray(
          menuItems.categoryId,
          cats.map((c) => c.id),
        ),
      )
    }
    await db.delete(categories).where(eq(categories.restaurantId, restaurantId))
    await db.delete(tables).where(eq(tables.restaurantId, restaurantId))
    await db.delete(restaurants).where(eq(restaurants.id, restaurantId))
  }
}, DB_TIMEOUT_MS)

interface OrderBody {
  data?: {
    id: string
    subtotal: number
    total: number
    items: {
      menuItemId: string
      nameSnapshot: string
      unitPrice: number
      quantity: number
      note: string | null
      status: string
      options: { optionName: string; priceDelta: number }[]
    }[]
  }
  error?: { code: string }
}

function submit(qrToken: string, body: unknown): Promise<Response> {
  return app.handle(
    new Request(`http://localhost/api/qr/${qrToken}/order-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

function readOrder(qrToken: string): Promise<Response> {
  return app.handle(new Request(`http://localhost/api/qr/${qrToken}/order`))
}

describe('POST /api/qr/:qrToken/order-items', () => {
  it(
    'prices items server-side, stores PENDING with snapshots, and recomputes totals',
    async () => {
      if (!schemaAvailable) return

      const menu = await seedMenu('A')
      const res = await submit(menu.qrToken, {
        items: [
          { menuItemId: menu.riceId, quantity: 2, optionIds: [menu.optLarge, menu.optEgg] },
          { menuItemId: menu.teaId, quantity: 1, note: 'ít đá' },
        ],
      })
      const body = (await res.json()) as OrderBody

      expect(res.status).toBe(201)
      const order = body.data!
      expect(order.items).toHaveLength(2)

      const rice = order.items.find((i) => i.menuItemId === menu.riceId)!
      expect(rice.unitPrice).toBe(60000) // 45000 + 10000 + 5000, client never sends price
      expect(rice.quantity).toBe(2)
      expect(rice.status).toBe('PENDING')
      expect(rice.options.map((o) => o.optionName)).toEqual(['Lớn', 'Trứng'])

      const tea = order.items.find((i) => i.menuItemId === menu.teaId)!
      expect(tea.unitPrice).toBe(5000)
      expect(tea.note).toBe('ít đá')

      // subtotal = 60000×2 + 5000×1; no discount → total equals subtotal.
      expect(order.subtotal).toBe(125000)
      expect(order.total).toBe(125000)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'appends on a second submit without opening a second order',
    async () => {
      if (!schemaAvailable) return

      const menu = await seedMenu('A')
      await submit(menu.qrToken, {
        items: [{ menuItemId: menu.riceId, quantity: 1, optionIds: [menu.optReg] }],
      })
      const second = await submit(menu.qrToken, {
        items: [{ menuItemId: menu.teaId, quantity: 3 }],
      })
      const body = (await second.json()) as OrderBody

      expect(second.status).toBe(201)
      expect(body.data!.items).toHaveLength(2)
      // 45000×1 + 5000×3
      expect(body.data!.subtotal).toBe(60000)

      const openOrders = await db
        .select({ id: orders.id })
        .from(orders)
        .innerJoin(tables, eq(orders.tableId, tables.id))
        .where(and(eq(tables.qrToken, menu.qrToken), eq(orders.status, 'OPEN')))
      expect(openOrders).toHaveLength(1)

      // GET returns the same accumulated order.
      const getRes = await readOrder(menu.qrToken)
      const getBody = (await getRes.json()) as OrderBody
      expect(getRes.status).toBe(200)
      expect(getBody.data!.id).toBe(body.data!.id)
      expect(getBody.data!.items).toHaveLength(2)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects a sold-out item with 409 ITEM_UNAVAILABLE and writes nothing',
    async () => {
      if (!schemaAvailable) return

      const menu = await seedMenu('A')
      const res = await submit(menu.qrToken, {
        items: [{ menuItemId: menu.phoId, quantity: 1 }],
      })
      const body = (await res.json()) as OrderBody

      expect(res.status).toBe(409)
      expect(body.error?.code).toBe('ITEM_UNAVAILABLE')

      const getBody = (await (await readOrder(menu.qrToken)).json()) as OrderBody
      expect(getBody.data!.items).toHaveLength(0)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects a non-positive quantity with 422 INVALID_QUANTITY',
    async () => {
      if (!schemaAvailable) return

      const menu = await seedMenu('A')
      const res = await submit(menu.qrToken, {
        items: [{ menuItemId: menu.riceId, quantity: 0, optionIds: [menu.optReg] }],
      })
      const body = (await res.json()) as OrderBody

      expect(res.status).toBe(422)
      expect(body.error?.code).toBe('INVALID_QUANTITY')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects a missing required option group with 422 MISSING_REQUIRED_OPTION',
    async () => {
      if (!schemaAvailable) return

      const menu = await seedMenu('A')
      const res = await submit(menu.qrToken, {
        items: [{ menuItemId: menu.riceId, quantity: 1, optionIds: [] }],
      })
      const body = (await res.json()) as OrderBody

      expect(res.status).toBe(422)
      expect(body.error?.code).toBe('MISSING_REQUIRED_OPTION')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects an item from another restaurant with 404 MENU_ITEM_NOT_FOUND',
    async () => {
      if (!schemaAvailable) return

      const menuA = await seedMenu('A')
      const menuB = await seedMenu('B')
      const res = await submit(menuA.qrToken, {
        items: [{ menuItemId: menuB.teaId, quantity: 1 }],
      })
      const body = (await res.json()) as OrderBody

      expect(res.status).toBe(404)
      expect(body.error?.code).toBe('MENU_ITEM_NOT_FOUND')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'returns 404 INVALID_TABLE for an unknown token',
    async () => {
      if (!schemaAvailable) return

      const res = await submit(`unknown-${randomUUID()}`, {
        items: [{ menuItemId: randomUUID(), quantity: 1 }],
      })
      const body = (await res.json()) as OrderBody

      expect(res.status).toBe(404)
      expect(body.error?.code).toBe('INVALID_TABLE')
    },
    DB_TIMEOUT_MS,
  )
})
