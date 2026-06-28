import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { hashPassword } from '../../src/infrastructure/auth/password'
import { generateRefreshToken, hashRefreshToken } from '../../src/infrastructure/auth/refresh-token'
import { db } from '../../src/infrastructure/database/client'
import { refreshTokens, restaurants, users } from '../../src/infrastructure/database/schema'
import { app } from '../../src/presentation/http/app'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'
import { errorCode } from '../support/http'

/**
 * Integration proof for US-009 refresh (with rotation + reuse detection) and logout.
 * Self-skips without a migrated DATABASE_URL; fixtures unwound in afterAll.
 */
let schemaAvailable = false

const password = 'rotate-me-pw'
const email = `refresh-${randomUUID()}@us009.test`
let restaurantId = ''
let userId = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return

  const [restaurant] = await db
    .insert(restaurants)
    .values({ name: 'US-009 Refresh Co' })
    .returning({ id: restaurants.id })
  restaurantId = restaurant!.id

  const [user] = await db
    .insert(users)
    .values({
      restaurantId,
      email,
      passwordHash: await hashPassword(password),
      name: 'Rotator',
      role: 'ADMIN',
    })
    .returning({ id: users.id })
  userId = user!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable || !restaurantId) return
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId))
  await db.delete(users).where(eq(users.restaurantId, restaurantId))
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId))
}, DB_TIMEOUT_MS)

function post(path: string, body: unknown): Promise<Response> {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

const login = () => post('/api/auth/login', { email, password })
const refresh = (refreshToken: string) => post('/api/auth/refresh', { refreshToken })
const logout = (refreshToken: string) => post('/api/auth/logout', { refreshToken })

async function freshRefreshToken(): Promise<string> {
  const { data } = (await (await login()).json()) as { data: { refreshToken: string } }
  return data.refreshToken
}

describe('POST /api/auth/refresh', () => {
  it(
    'issues a new access token and rotates the refresh token',
    async () => {
      if (!schemaAvailable) return
      const r1 = await freshRefreshToken()

      const res = await refresh(r1)
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as {
        data: { accessToken: string; refreshToken: string }
      }
      expect(data.accessToken).toBeString()
      expect(data.refreshToken).toBeString()
      expect(data.refreshToken).not.toBe(r1)

      // The freshly issued token works…
      expect((await refresh(data.refreshToken)).status).toBe(200)
      // …while replaying the rotated-away token is rejected (and, as reuse, kills the
      // family — see the dedicated reuse-detection test).
      expect((await refresh(r1)).status).toBe(401)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'detects reuse of a rotated token and revokes the whole session family',
    async () => {
      if (!schemaAvailable) return
      const r1 = await freshRefreshToken()
      const { data } = (await (await refresh(r1)).json()) as { data: { refreshToken: string } }
      const r2 = data.refreshToken

      // Replay the already-rotated r1: reuse → revoke everything for this user.
      const replay = await refresh(r1)
      expect(replay.status).toBe(401)
      expect(await errorCode(replay)).toBe('TOKEN_REVOKED')

      // r2 was valid a moment ago but the reuse nuked the family.
      expect((await refresh(r2)).status).toBe(401)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects an unknown refresh token with 401',
    async () => {
      if (!schemaAvailable) return
      const res = await refresh(generateRefreshToken())
      expect(res.status).toBe(401)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects an expired refresh token with 401 TOKEN_EXPIRED',
    async () => {
      if (!schemaAvailable) return
      const raw = generateRefreshToken()
      await db.insert(refreshTokens).values({
        userId,
        tokenHash: hashRefreshToken(raw),
        expiresAt: new Date(Date.now() - 1000),
      })
      const res = await refresh(raw)
      expect(res.status).toBe(401)
      expect(await errorCode(res)).toBe('TOKEN_EXPIRED')
    },
    DB_TIMEOUT_MS,
  )
})

describe('POST /api/auth/logout', () => {
  it(
    'revokes the presented token (204) and is idempotent',
    async () => {
      if (!schemaAvailable) return
      const r1 = await freshRefreshToken()

      const first = await logout(r1)
      expect(first.status).toBe(204)

      // Idempotent: revoking an already-revoked token still succeeds.
      expect((await logout(r1)).status).toBe(204)

      // A logged-out token can no longer be refreshed.
      expect((await refresh(r1)).status).toBe(401)
    },
    DB_TIMEOUT_MS,
  )
})
