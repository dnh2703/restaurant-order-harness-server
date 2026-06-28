import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { hashPassword } from '../../src/infrastructure/auth/password'
import { db } from '../../src/infrastructure/database/client'
import { orders, restaurants, tables, users } from '../../src/infrastructure/database/schema'
import { app } from '../../src/presentation/http/app'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'
import { errorCode } from '../support/http'

let schemaAvailable = false
const password = 'admin-pw-us017'
const adminAEmail = `admin-a-${randomUUID()}@us017.test`
const adminBEmail = `admin-b-${randomUUID()}@us017.test`
const cashierAEmail = `cashier-a-${randomUUID()}@us017.test`
let restaurantAId = ''
let restaurantBId = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const passwordHash = await hashPassword(password)
  const [a] = await db
    .insert(restaurants)
    .values({ name: 'US-017 A' })
    .returning({ id: restaurants.id })
  restaurantAId = a!.id
  const [b] = await db
    .insert(restaurants)
    .values({ name: 'US-017 B' })
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
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable) return
  for (const rid of [restaurantAId, restaurantBId].filter(Boolean)) {
    await db.delete(orders).where(eq(orders.restaurantId, rid)) // cascades order_items
    await db.delete(tables).where(eq(tables.restaurantId, rid))
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

describe('tables CRUD', () => {
  it(
    'rejects a non-admin with 403 and a missing token with 401',
    async () => {
      if (!schemaAvailable) return
      const cashier = await tokenFor(cashierAEmail)
      expect((await req('/tables', { token: cashier })).status).toBe(403)
      expect((await req('/tables')).status).toBe(401)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'creates (minting a token), lists, updates, and deletes scoped to the admin restaurant',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)

      const created = await req('/tables', {
        method: 'POST',
        token,
        body: { name: 'Bàn 1', capacity: 4 },
      })
      expect(created.status).toBe(201)
      const { data: c } = (await created.json()) as {
        data: { table: { id: string; qrToken: string; status: string; capacity: number | null } }
      }
      expect(c.table.status).toBe('EMPTY')
      expect(c.table.qrToken.length).toBeGreaterThan(0)
      expect(c.table.capacity).toBe(4)
      const id = c.table.id

      const listed = await req('/tables', { token })
      expect(listed.status).toBe(200)
      const { data: l } = (await listed.json()) as { data: { tables: Array<{ id: string }> } }
      expect(l.tables.some((x) => x.id === id)).toBe(true)

      const patched = await req(`/tables/${id}`, {
        method: 'PATCH',
        token,
        body: { name: 'Bàn 1A', capacity: 6 },
      })
      expect(patched.status).toBe(200)
      const { data: p } = (await patched.json()) as {
        data: { table: { name: string; capacity: number } }
      }
      expect(p.table).toMatchObject({ name: 'Bàn 1A', capacity: 6 })

      const del = await req(`/tables/${id}`, { method: 'DELETE', token })
      expect(del.status).toBe(204)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'ignores a client-supplied status and qrToken on create',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const res = await req('/tables', {
        method: 'POST',
        token,
        body: { name: 'Sneaky', status: 'OCCUPIED', qrToken: 'client-chosen' },
      })
      // Extra fields are stripped by the TypeBox body schema; create still succeeds with defaults.
      expect(res.status).toBe(201)
      const { data } = (await res.json()) as {
        data: { table: { status: string; qrToken: string } }
      }
      expect(data.table.status).toBe('EMPTY')
      expect(data.table.qrToken).not.toBe('client-chosen')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'regenerate-qr replaces the token; the old token no longer resolves and the new one does',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const created = await req('/tables', { method: 'POST', token, body: { name: 'QR table' } })
      const { data: c } = (await created.json()) as {
        data: { table: { id: string; qrToken: string } }
      }
      const oldToken = c.table.qrToken

      const regen = await req(`/tables/${c.table.id}/regenerate-qr`, { method: 'POST', token })
      expect(regen.status).toBe(200)
      const { data: r } = (await regen.json()) as { data: { table: { qrToken: string } } }
      const newToken = r.table.qrToken
      expect(newToken).not.toBe(oldToken)

      // The customer QR-resolve route (US-005) is public.
      expect((await req(`/qr/${oldToken}`)).status).toBe(404)
      expect((await req(`/qr/${newToken}`)).status).toBe(200)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'cannot touch another restaurant table — 404 TABLE_NOT_FOUND',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const [bTable] = await db
        .insert(tables)
        .values({ restaurantId: restaurantBId, name: 'B table', qrToken: `tok-${randomUUID()}` })
        .returning({ id: tables.id })
      const res = await req(`/tables/${bTable!.id}`, {
        method: 'PATCH',
        token,
        body: { name: 'Hijack' },
      })
      expect(res.status).toBe(404)
      expect(await errorCode(res)).toBe('TABLE_NOT_FOUND')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'refuses to delete a table that has an OPEN order — 409 TABLE_IN_USE',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const [table] = await db
        .insert(tables)
        .values({ restaurantId: restaurantAId, name: 'Busy', qrToken: `tok-${randomUUID()}` })
        .returning({ id: tables.id })
      await db.insert(orders).values({ restaurantId: restaurantAId, tableId: table!.id })
      const res = await req(`/tables/${table!.id}`, { method: 'DELETE', token })
      expect(res.status).toBe(409)
      expect(await errorCode(res)).toBe('TABLE_IN_USE')
    },
    DB_TIMEOUT_MS,
  )
})
