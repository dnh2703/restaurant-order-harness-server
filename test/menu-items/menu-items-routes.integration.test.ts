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
  restaurants,
  tables,
  users,
} from '../../src/infrastructure/database/schema'
import { app } from '../../src/presentation/http/app'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'
import { errorCode } from '../support/http'

let schemaAvailable = false
const password = 'admin-pw-us015'
const adminAEmail = `admin-a-${randomUUID()}@us015.test`
const adminBEmail = `admin-b-${randomUUID()}@us015.test`
const cashierAEmail = `cashier-a-${randomUUID()}@us015.test`
let restaurantAId = ''
let restaurantBId = ''
let categoryAId = ''
let categoryBId = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const passwordHash = await hashPassword(password)
  const [a] = await db
    .insert(restaurants)
    .values({ name: 'US-015 A' })
    .returning({ id: restaurants.id })
  restaurantAId = a!.id
  const [b] = await db
    .insert(restaurants)
    .values({ name: 'US-015 B' })
    .returning({ id: restaurants.id })
  restaurantBId = b!.id
  await db.insert(users).values([
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
  const [catA] = await db
    .insert(categories)
    .values({ restaurantId: restaurantAId, name: 'A Mains', sortOrder: 0 })
    .returning({ id: categories.id })
  categoryAId = catA!.id
  const [catB] = await db
    .insert(categories)
    .values({ restaurantId: restaurantBId, name: 'B Only', sortOrder: 0 })
    .returning({ id: categories.id })
  categoryBId = catB!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable) return
  for (const rid of [restaurantAId, restaurantBId].filter(Boolean)) {
    await db.delete(orders).where(eq(orders.restaurantId, rid)) // cascades order_items
    await db.delete(tables).where(eq(tables.restaurantId, rid))
    const cats = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.restaurantId, rid))
    const catIds = cats.map((c) => c.id)
    if (catIds.length) await db.delete(menuItems).where(inArray(menuItems.categoryId, catIds))
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

describe('menu-items CRUD', () => {
  it(
    'rejects a non-admin with 403 and a missing token with 401',
    async () => {
      if (!schemaAvailable) return
      const cashier = await tokenFor(cashierAEmail)
      expect((await req('/menu-items', { token: cashier })).status).toBe(403)
      expect((await req('/menu-items')).status).toBe(401)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'creates, lists, updates, and deletes scoped to the admin restaurant',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)

      const created = await req('/menu-items', {
        method: 'POST',
        token,
        body: { categoryId: categoryAId, name: 'Pho', price: 50000 },
      })
      expect(created.status).toBe(201)
      const { data: c } = (await created.json()) as {
        data: {
          menuItem: { id: string; isAvailable: boolean; sortOrder: number; categoryId: string }
        }
      }
      expect(c.menuItem.isAvailable).toBe(true)
      expect(c.menuItem.sortOrder).toBe(0)
      expect(c.menuItem.categoryId).toBe(categoryAId)
      const id = c.menuItem.id

      const listed = await req('/menu-items', { token })
      expect(listed.status).toBe(200)
      const { data: l } = (await listed.json()) as {
        data: { menuItems: Array<{ id: string; categoryId: string }> }
      }
      expect(l.menuItems.some((x) => x.id === id)).toBe(true)
      expect(l.menuItems.some((x) => x.categoryId === categoryBId)).toBe(false)

      const patched = await req(`/menu-items/${id}`, {
        method: 'PATCH',
        token,
        body: { price: 55000, isAvailable: false },
      })
      expect(patched.status).toBe(200)
      const { data: p } = (await patched.json()) as {
        data: { menuItem: { price: number; isAvailable: boolean } }
      }
      expect(p.menuItem).toMatchObject({ price: 55000, isAvailable: false })

      const del = await req(`/menu-items/${id}`, { method: 'DELETE', token })
      expect(del.status).toBe(204)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects a price below zero with 400',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const res = await req('/menu-items', {
        method: 'POST',
        token,
        body: { categoryId: categoryAId, name: 'Bad', price: -1 },
      })
      expect(res.status).toBe(400)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'cannot create into another restaurant category — 404 CATEGORY_NOT_FOUND',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const res = await req('/menu-items', {
        method: 'POST',
        token,
        body: { categoryId: categoryBId, name: 'Sneaky', price: 1000 },
      })
      expect(res.status).toBe(404)
      expect(await errorCode(res)).toBe('CATEGORY_NOT_FOUND')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'cannot touch another restaurant item — 404 MENU_ITEM_NOT_FOUND',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const [bItem] = await db
        .insert(menuItems)
        .values({ categoryId: categoryBId, name: 'B Dish', price: 1000 })
        .returning({ id: menuItems.id })
      const res = await req(`/menu-items/${bItem!.id}`, {
        method: 'PATCH',
        token,
        body: { name: 'Hijack' },
      })
      expect(res.status).toBe(404)
      expect(await errorCode(res)).toBe('MENU_ITEM_NOT_FOUND')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'refuses to delete an item referenced by order history — 409 MENU_ITEM_IN_USE',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const [item] = await db
        .insert(menuItems)
        .values({ categoryId: categoryAId, name: 'Ordered', price: 1000 })
        .returning({ id: menuItems.id, name: menuItems.name, price: menuItems.price })
      const [table] = await db
        .insert(tables)
        .values({ restaurantId: restaurantAId, name: 'T1', qrToken: `qr-${randomUUID()}` })
        .returning({ id: tables.id })
      const [order] = await db
        .insert(orders)
        .values({ restaurantId: restaurantAId, tableId: table!.id })
        .returning({ id: orders.id })
      await db.insert(orderItems).values({
        orderId: order!.id,
        menuItemId: item!.id,
        nameSnapshot: item!.name,
        unitPrice: item!.price,
        quantity: 1,
      })
      const res = await req(`/menu-items/${item!.id}`, { method: 'DELETE', token })
      expect(res.status).toBe(409)
      expect(await errorCode(res)).toBe('MENU_ITEM_IN_USE')
    },
    DB_TIMEOUT_MS,
  )
})
