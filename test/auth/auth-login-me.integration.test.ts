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
 * Integration proof for US-009 login + guarded /me. Self-skips without a migrated
 * DATABASE_URL. Fixtures (one active ADMIN, one inactive user) are created per-suite and
 * unwound in afterAll, leaving the canonical US-002 seed untouched.
 */
let schemaAvailable = false

const password = 'sup3r-secret-pw'
const adminEmail = `admin-${randomUUID()}@us009.test`
const inactiveEmail = `inactive-${randomUUID()}@us009.test`
let restaurantId = ''
let adminId = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return

  const [restaurant] = await db
    .insert(restaurants)
    .values({ name: 'US-009 Login Co' })
    .returning({ id: restaurants.id })
  restaurantId = restaurant!.id

  const passwordHash = await hashPassword(password)
  const [admin] = await db
    .insert(users)
    .values({ restaurantId, email: adminEmail, passwordHash, name: 'Admin', role: 'ADMIN' })
    .returning({ id: users.id })
  adminId = admin!.id

  await db.insert(users).values({
    restaurantId,
    email: inactiveEmail,
    passwordHash,
    name: 'Inactive',
    role: 'CASHIER',
    isActive: false,
  })
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable || !restaurantId) return
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, adminId))
  await db.delete(users).where(eq(users.restaurantId, restaurantId))
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId))
}, DB_TIMEOUT_MS)

function login(body: unknown): Promise<Response> {
  return app.handle(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

function me(token?: string): Promise<Response> {
  return app.handle(
    new Request('http://localhost/api/auth/me', {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  )
}

describe('POST /api/auth/login', () => {
  it(
    'issues access + refresh tokens and persists a hashed refresh row',
    async () => {
      if (!schemaAvailable) return

      const res = await login({ email: adminEmail, password })
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as {
        data: { accessToken: string; refreshToken: string; user: { id: string; role: string } }
      }
      expect(data.accessToken).toBeString()
      expect(data.refreshToken).toBeString()
      expect(data.user.id).toBe(adminId)
      expect(data.user.role).toBe('ADMIN')

      // The raw refresh token is never stored; only its hash lands in the DB.
      const rows = await db
        .select({ tokenHash: refreshTokens.tokenHash })
        .from(refreshTokens)
        .where(eq(refreshTokens.userId, adminId))
      expect(rows.length).toBeGreaterThanOrEqual(1)
      for (const row of rows) expect(row.tokenHash).not.toBe(data.refreshToken)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects a wrong password with 401 INVALID_CREDENTIALS',
    async () => {
      if (!schemaAvailable) return
      const res = await login({ email: adminEmail, password: 'wrong' })
      expect(res.status).toBe(401)
      expect(await errorCode(res)).toBe('INVALID_CREDENTIALS')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects an unknown email with 401 INVALID_CREDENTIALS',
    async () => {
      if (!schemaAvailable) return
      const res = await login({ email: `nobody-${randomUUID()}@x.test`, password })
      expect(res.status).toBe(401)
      expect(await errorCode(res)).toBe('INVALID_CREDENTIALS')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects an inactive user with 401 INVALID_CREDENTIALS',
    async () => {
      if (!schemaAvailable) return
      const res = await login({ email: inactiveEmail, password })
      expect(res.status).toBe(401)
      expect(await errorCode(res)).toBe('INVALID_CREDENTIALS')
    },
    DB_TIMEOUT_MS,
  )
})

describe('GET /api/auth/me', () => {
  it(
    'returns the current user for a valid access token',
    async () => {
      if (!schemaAvailable) return
      const { data } = (await (await login({ email: adminEmail, password })).json()) as {
        data: { accessToken: string }
      }
      const res = await me(data.accessToken)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { user: { id: string; email: string } } }
      expect(body.data.user.id).toBe(adminId)
      expect(body.data.user.email).toBe(adminEmail)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects a missing token with 401',
    async () => {
      if (!schemaAvailable) return
      const res = await me()
      expect(res.status).toBe(401)
      expect(await errorCode(res)).toBe('UNAUTHORIZED')
    },
    DB_TIMEOUT_MS,
  )
})
