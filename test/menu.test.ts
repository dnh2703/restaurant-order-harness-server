import { randomUUID } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'

import { db } from '../src/infrastructure/database/client'
import {
  categories,
  menuItems,
  optionGroups,
  options,
  restaurants,
  tables,
} from '../src/infrastructure/database/schema'
import { app } from '../src/presentation/http/app'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from './support/db'

/**
 * Integration proof for US-006 (menu browse by category). Drives the public
 * `GET /api/qr/:qrToken/menu` route through `app.handle(...)` against a seeded menu and
 * asserts the grouped/ordered shape, the sold-out flag, nested options, and that the read
 * is scoped to the QR session's restaurant (no cross-restaurant leakage).
 *
 * Requires a migrated DATABASE_URL (a Neon branch); self-skips otherwise (see ./support/db).
 */
let schemaAvailable = false

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
}, WARMUP_TIMEOUT_MS)

const createdRestaurantIds: string[] = []

/**
 * Seed one restaurant with a QR table and a two-category menu. `Drinks` is inserted before
 * `Mains` but has the higher `sort_order`, and within `Mains` the dishes are inserted out of
 * `sort_order`, so the response ordering can only be right if the query sorts (not insert
 * order). One dish is sold out; one dish carries a required SINGLE option group.
 */
async function seedRestaurantMenu(label: string): Promise<{ qrToken: string }> {
  const qrToken = `menu-${label}-${randomUUID()}`
  const [restaurant] = await db
    .insert(restaurants)
    .values({ name: `Menu Test Co ${label}` })
    .returning({ id: restaurants.id })
  const restaurantId = restaurant!.id
  createdRestaurantIds.push(restaurantId)

  await db.insert(tables).values({ restaurantId, name: `Table ${label}`, qrToken })

  const [drinks] = await db
    .insert(categories)
    .values({ restaurantId, name: `Drinks ${label}`, sortOrder: 1 })
    .returning({ id: categories.id })
  const [mains] = await db
    .insert(categories)
    .values({ restaurantId, name: `Mains ${label}`, sortOrder: 0 })
    .returning({ id: categories.id })

  // Inserted out of sort_order on purpose: Phở (sort 1, sold out) before Cơm (sort 0).
  await db.insert(menuItems).values({
    categoryId: mains!.id,
    name: `Phở ${label}`,
    price: 50000,
    sortOrder: 1,
    isAvailable: false,
  })
  const [rice] = await db
    .insert(menuItems)
    .values({
      categoryId: mains!.id,
      name: `Cơm ${label}`,
      description: 'Broken rice',
      price: 45000,
      sortOrder: 0,
    })
    .returning({ id: menuItems.id })
  await db.insert(menuItems).values({
    categoryId: drinks!.id,
    name: `Trà đá ${label}`,
    price: 5000,
    sortOrder: 0,
  })

  const [size] = await db
    .insert(optionGroups)
    .values({ menuItemId: rice!.id, name: 'Size', type: 'SINGLE', isRequired: true })
    .returning({ id: optionGroups.id })
  await db.insert(options).values([
    { optionGroupId: size!.id, name: 'Thường', priceDelta: 0 },
    { optionGroupId: size!.id, name: 'Lớn', priceDelta: 10000 },
  ])

  return { qrToken }
}

afterEach(async () => {
  for (const restaurantId of createdRestaurantIds.splice(0)) {
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

interface MenuBody {
  data?: {
    categories: {
      id: string
      name: string
      items: {
        id: string
        name: string
        description: string | null
        isAvailable: boolean
        optionGroups: {
          name: string
          type: string
          isRequired: boolean
          options: { name: string; priceDelta: number }[]
        }[]
      }[]
    }[]
  }
}

function readMenu(qrToken: string): Promise<Response> {
  return app.handle(new Request(`http://localhost/api/qr/${qrToken}/menu`))
}

describe('GET /api/qr/:qrToken/menu', () => {
  it(
    'returns 404 INVALID_TABLE for an unknown token',
    async () => {
      if (!schemaAvailable) return

      const res = await readMenu(`unknown-${randomUUID()}`)
      const body = (await res.json()) as { error?: { code: string } }

      expect(res.status).toBe(404)
      expect(body.error?.code).toBe('INVALID_TABLE')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'returns the menu grouped + ordered by sort_order with the sold-out flag and nested options',
    async () => {
      if (!schemaAvailable) return

      const { qrToken } = await seedRestaurantMenu('A')

      const res = await readMenu(qrToken)
      const body = (await res.json()) as MenuBody

      expect(res.status).toBe(200)
      const cats = body.data?.categories ?? []
      expect(cats.map((c) => c.name)).toEqual(['Mains A', 'Drinks A'])

      const mains = cats[0]
      expect(mains?.items.map((i) => i.name)).toEqual(['Cơm A', 'Phở A'])

      const rice = mains?.items[0]
      expect(rice?.description).toBe('Broken rice')
      expect(rice?.isAvailable).toBe(true)
      expect(rice?.optionGroups).toHaveLength(1)
      expect(rice?.optionGroups[0]?.name).toBe('Size')
      expect(rice?.optionGroups[0]?.isRequired).toBe(true)
      expect(rice?.optionGroups[0]?.options.map((o) => o.name)).toEqual(['Thường', 'Lớn'])
      expect(rice?.optionGroups[0]?.options.map((o) => o.priceDelta)).toEqual([0, 10000])

      const pho = mains?.items[1]
      expect(pho?.isAvailable).toBe(false)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'scopes the read to the QR session restaurant (no cross-restaurant leakage)',
    async () => {
      if (!schemaAvailable) return

      const { qrToken } = await seedRestaurantMenu('A')
      await seedRestaurantMenu('B')

      const res = await readMenu(qrToken)
      const body = (await res.json()) as MenuBody
      const names = (body.data?.categories ?? []).flatMap((c) => [
        c.name,
        ...c.items.map((i) => i.name),
      ])

      expect(res.status).toBe(200)
      expect(names.every((n) => n.endsWith('A'))).toBe(true)
      expect(names.some((n) => n.endsWith('B'))).toBe(false)
    },
    DB_TIMEOUT_MS,
  )
})
