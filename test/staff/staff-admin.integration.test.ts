import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { hashPassword } from '../../src/infrastructure/auth/password'
import { db } from '../../src/infrastructure/database/client'
import { refreshTokens, restaurants, users } from '../../src/infrastructure/database/schema'
import { app } from '../../src/presentation/http/app'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'
import { errorCode } from '../support/http'

/**
 * Integration proof for US-010 staff account & role administration. Self-skips without a
 * migrated DATABASE_URL. Two restaurants (A and B) are created per-suite so the
 * cross-tenant isolation cases are real; everything is unwound in afterAll, leaving the
 * canonical US-002 seed untouched.
 */
let schemaAvailable = false

const password = 'admin-pw-us010'
const adminAEmail = `admin-a-${randomUUID()}@us010.test`
const adminBEmail = `admin-b-${randomUUID()}@us010.test`
const cashierAEmail = `cashier-a-${randomUUID()}@us010.test`

let restaurantAId = ''
let restaurantBId = ''
let adminAId = ''
let cashierAId = ''
let userBId = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return

  const passwordHash = await hashPassword(password)

  const [a] = await db
    .insert(restaurants)
    .values({ name: 'US-010 Restaurant A' })
    .returning({ id: restaurants.id })
  restaurantAId = a!.id
  const [b] = await db
    .insert(restaurants)
    .values({ name: 'US-010 Restaurant B' })
    .returning({ id: restaurants.id })
  restaurantBId = b!.id

  const [adminA] = await db
    .insert(users)
    .values({
      restaurantId: restaurantAId,
      email: adminAEmail,
      passwordHash,
      name: 'Admin A',
      role: 'ADMIN',
    })
    .returning({ id: users.id })
  adminAId = adminA!.id
  const [cashier] = await db
    .insert(users)
    .values({
      restaurantId: restaurantAId,
      email: cashierAEmail,
      passwordHash,
      name: 'Cashier A',
      role: 'CASHIER',
    })
    .returning({ id: users.id })
  cashierAId = cashier!.id

  await db.insert(users).values({
    restaurantId: restaurantBId,
    email: adminBEmail,
    passwordHash,
    name: 'Admin B',
    role: 'ADMIN',
  })
  const [userB] = await db
    .insert(users)
    .values({
      restaurantId: restaurantBId,
      email: `staff-b-${randomUUID()}@us010.test`,
      passwordHash,
      name: 'Staff B',
      role: 'KITCHEN',
    })
    .returning({ id: users.id })
  userBId = userB!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable) return
  for (const rid of [restaurantAId, restaurantBId].filter(Boolean)) {
    const staff = await db.select({ id: users.id }).from(users).where(eq(users.restaurantId, rid))
    for (const s of staff) await db.delete(refreshTokens).where(eq(refreshTokens.userId, s.id))
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

function staffReq(
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

describe('GET /api/staff', () => {
  it(
    'lists staff scoped to the admin restaurant and never another tenant',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const res = await staffReq('/staff', { token })
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as {
        data: { staff: Array<{ id: string; restaurantId: string; email: string }> }
      }
      expect(data.staff.length).toBeGreaterThanOrEqual(2)
      for (const s of data.staff) {
        expect(s.restaurantId).toBe(restaurantAId)
        expect(s).not.toHaveProperty('passwordHash')
      }
      expect(data.staff.some((s) => s.id === userBId)).toBe(false)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects a non-admin with 403 FORBIDDEN',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(cashierAEmail)
      const res = await staffReq('/staff', { token })
      expect(res.status).toBe(403)
      expect(await errorCode(res)).toBe('FORBIDDEN')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects a missing token with 401',
    async () => {
      if (!schemaAvailable) return
      const res = await staffReq('/staff')
      expect(res.status).toBe(401)
      expect(await errorCode(res)).toBe('UNAUTHORIZED')
    },
    DB_TIMEOUT_MS,
  )
})

describe('POST /api/staff', () => {
  it(
    'creates a staff member, hashes the password, omits the hash, and the user can log in',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const email = `new-cook-${randomUUID()}@us010.test`
      const res = await staffReq('/staff', {
        method: 'POST',
        token,
        body: { email, password: 'cook-initial-pw', name: 'New Cook', role: 'KITCHEN' },
      })
      expect(res.status).toBe(201)
      const { data } = (await res.json()) as {
        data: { user: { id: string; email: string; role: string; restaurantId: string } }
      }
      expect(data.user.email).toBe(email)
      expect(data.user.role).toBe('KITCHEN')
      expect(data.user.restaurantId).toBe(restaurantAId)
      expect(data.user).not.toHaveProperty('passwordHash')

      // The stored hash is not the plaintext.
      const [row] = await db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, data.user.id))
      expect(row!.passwordHash).not.toBe('cook-initial-pw')

      // The created credentials actually work.
      const login = await app.handle(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password: 'cook-initial-pw' }),
        }),
      )
      expect(login.status).toBe(200)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects a duplicate email with 409 EMAIL_TAKEN',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const res = await staffReq('/staff', {
        method: 'POST',
        token,
        body: { email: adminAEmail, password: 'whatever-pw', name: 'Dup', role: 'CASHIER' },
      })
      expect(res.status).toBe(409)
      expect(await errorCode(res)).toBe('EMAIL_TAKEN')
    },
    DB_TIMEOUT_MS,
  )
})

describe('PATCH /api/staff/:id', () => {
  it(
    'updates name and role within the restaurant',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const res = await staffReq(`/staff/${cashierAId}`, {
        method: 'PATCH',
        token,
        body: { name: 'Cashier Renamed', role: 'KITCHEN' },
      })
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as {
        data: { user: { name: string; role: string } }
      }
      expect(data.user.name).toBe('Cashier Renamed')
      expect(data.user.role).toBe('KITCHEN')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'cannot touch another restaurant user — 404 USER_NOT_FOUND, no leakage',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const res = await staffReq(`/staff/${userBId}`, {
        method: 'PATCH',
        token,
        body: { name: 'Hijacked' },
      })
      expect(res.status).toBe(404)
      expect(await errorCode(res)).toBe('USER_NOT_FOUND')
    },
    DB_TIMEOUT_MS,
  )
})

describe('PATCH /api/staff/:id/active', () => {
  it(
    'deactivating a user revokes their refresh tokens so they can no longer refresh',
    async () => {
      if (!schemaAvailable) return
      const adminToken = await tokenFor(adminAEmail)

      // A fresh victim user with an active session (login → refresh token).
      const email = `victim-${randomUUID()}@us010.test`
      const created = await staffReq('/staff', {
        method: 'POST',
        token: adminToken,
        body: { email, password: 'victim-pw', name: 'Victim', role: 'CASHIER' },
      })
      const { data: createdData } = (await created.json()) as { data: { user: { id: string } } }
      const victimId = createdData.user.id

      const login = await app.handle(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password: 'victim-pw' }),
        }),
      )
      const { data: loginData } = (await login.json()) as { data: { refreshToken: string } }

      // Admin deactivates the victim.
      const res = await staffReq(`/staff/${victimId}/active`, {
        method: 'PATCH',
        token: adminToken,
        body: { isActive: false },
      })
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as { data: { user: { isActive: boolean } } }
      expect(data.user.isActive).toBe(false)

      // The victim's refresh token is dead.
      const refresh = await app.handle(
        new Request('http://localhost/api/auth/refresh', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: loginData.refreshToken }),
        }),
      )
      expect(refresh.status).toBe(401)

      // And the victim can no longer log in.
      const reLogin = await app.handle(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password: 'victim-pw' }),
        }),
      )
      expect(reLogin.status).toBe(401)
    },
    DB_TIMEOUT_MS,
  )
})

describe('last-admin protection', () => {
  it(
    'refuses to demote the only active admin — 409 LAST_ADMIN',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const res = await staffReq(`/staff/${adminAId}`, {
        method: 'PATCH',
        token,
        body: { role: 'CASHIER' },
      })
      expect(res.status).toBe(409)
      expect(await errorCode(res)).toBe('LAST_ADMIN')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'refuses to deactivate the only active admin — 409 LAST_ADMIN',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const res = await staffReq(`/staff/${adminAId}/active`, {
        method: 'PATCH',
        token,
        body: { isActive: false },
      })
      expect(res.status).toBe(409)
      expect(await errorCode(res)).toBe('LAST_ADMIN')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'allows demoting an admin once a second active admin exists',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)

      // Promote a second admin so adminA is no longer the only one…
      const email = `second-admin-${randomUUID()}@us010.test`
      const created = await staffReq('/staff', {
        method: 'POST',
        token,
        body: { email, password: 'second-admin-pw', name: 'Second Admin', role: 'ADMIN' },
      })
      const { data: createdData } = (await created.json()) as { data: { user: { id: string } } }
      const secondAdminId = createdData.user.id

      // …now that second admin can be demoted (adminA still covers the restaurant).
      const res = await staffReq(`/staff/${secondAdminId}`, {
        method: 'PATCH',
        token,
        body: { role: 'KITCHEN' },
      })
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as { data: { user: { role: string } } }
      expect(data.user.role).toBe('KITCHEN')
    },
    DB_TIMEOUT_MS,
  )
})
