// test/categories/categories-routes.integration.test.ts
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { hashPassword } from '../../src/infrastructure/auth/password'
import { db } from '../../src/infrastructure/database/client'
import { categories, menuItems, restaurants, users } from '../../src/infrastructure/database/schema'
import { app } from '../../src/presentation/http/app'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'
import { errorCode } from '../support/http'

let schemaAvailable = false
const password = 'admin-pw-us014'
const adminAEmail = `admin-a-${randomUUID()}@us014.test`
const adminBEmail = `admin-b-${randomUUID()}@us014.test`
const cashierAEmail = `cashier-a-${randomUUID()}@us014.test`
let restaurantAId = ''
let restaurantBId = ''
let categoryBId = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const passwordHash = await hashPassword(password)
  const [a] = await db
    .insert(restaurants)
    .values({ name: 'US-014 A' })
    .returning({ id: restaurants.id })
  restaurantAId = a!.id
  const [b] = await db
    .insert(restaurants)
    .values({ name: 'US-014 B' })
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
  const [catB] = await db
    .insert(categories)
    .values({ restaurantId: restaurantBId, name: 'B Only', sortOrder: 0 })
    .returning({ id: categories.id })
  categoryBId = catB!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable) return
  for (const rid of [restaurantAId, restaurantBId].filter(Boolean)) {
    const cats = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.restaurantId, rid))
    for (const c of cats) await db.delete(menuItems).where(eq(menuItems.categoryId, c.id))
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

describe('categories CRUD', () => {
  it(
    'rejects a non-admin with 403 and a missing token with 401',
    async () => {
      if (!schemaAvailable) return
      const cashier = await tokenFor(cashierAEmail)
      expect((await req('/categories', { token: cashier })).status).toBe(403)
      expect((await req('/categories')).status).toBe(401)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'creates, lists, updates, and deletes scoped to the admin restaurant',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)

      const created = await req('/categories', { method: 'POST', token, body: { name: 'Drinks' } })
      expect(created.status).toBe(201)
      const { data: c } = (await created.json()) as {
        data: { category: { id: string; sortOrder: number; restaurantId: string } }
      }
      expect(c.category.sortOrder).toBe(0)
      expect(c.category.restaurantId).toBe(restaurantAId)
      const id = c.category.id

      const listed = await req('/categories', { token })
      expect(listed.status).toBe(200)
      const { data: l } = (await listed.json()) as {
        data: { categories: Array<{ id: string; restaurantId: string }> }
      }
      expect(l.categories.some((x) => x.id === id)).toBe(true)
      for (const x of l.categories) expect(x.restaurantId).toBe(restaurantAId)
      expect(l.categories.some((x) => x.id === categoryBId)).toBe(false)

      const patched = await req(`/categories/${id}`, {
        method: 'PATCH',
        token,
        body: { name: 'Beverages', sortOrder: 4 },
      })
      expect(patched.status).toBe(200)
      const { data: p } = (await patched.json()) as {
        data: { category: { name: string; sortOrder: number } }
      }
      expect(p.category).toMatchObject({ name: 'Beverages', sortOrder: 4 })

      const del = await req(`/categories/${id}`, { method: 'DELETE', token })
      expect(del.status).toBe(204)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'cannot touch another restaurant category — 404 CATEGORY_NOT_FOUND',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const res = await req(`/categories/${categoryBId}`, {
        method: 'PATCH',
        token,
        body: { name: 'Hijack' },
      })
      expect(res.status).toBe(404)
      expect(await errorCode(res)).toBe('CATEGORY_NOT_FOUND')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'refuses to delete a category that still has menu items — 409 CATEGORY_NOT_EMPTY',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const created = await req('/categories', {
        method: 'POST',
        token,
        body: { name: 'HasItems' },
      })
      const { data: c } = (await created.json()) as { data: { category: { id: string } } }
      await db.insert(menuItems).values({ categoryId: c.category.id, name: 'Dish', price: 1000 })
      const res = await req(`/categories/${c.category.id}`, { method: 'DELETE', token })
      expect(res.status).toBe(409)
      expect(await errorCode(res)).toBe('CATEGORY_NOT_EMPTY')
    },
    DB_TIMEOUT_MS,
  )
})
