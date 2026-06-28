import { Elysia } from 'elysia'
import { beforeAll, describe, expect, test } from 'bun:test'

import { signAccessToken } from '../../src/infrastructure/auth/access-token'
import { authGuard } from '../../src/presentation/http/plugins/auth-guard'
import { errorHandler } from '../../src/presentation/http/plugins/error-handler'
import { errorCode } from '../support/http'

/**
 * Pure authorization wiring — no DB. A probe app mounts the guard with different role
 * requirements and we drive it with `app.handle` to prove 401/403/200 outcomes and that
 * the verified identity is attached to context.
 */
const app = new Elysia()
  .use(errorHandler)
  .use(authGuard)
  .get('/whoami', ({ auth }) => auth, { auth: true })
  .get('/admin-only', ({ auth }) => auth, { auth: ['ADMIN'] })

const admin = {
  userId: 'a0000000-0000-0000-0000-000000000001',
  role: 'ADMIN' as const,
  restaurantId: 'r0000000-0000-0000-0000-000000000001',
}
const kitchen = {
  ...admin,
  userId: 'a0000000-0000-0000-0000-000000000002',
  role: 'KITCHEN' as const,
}

let adminToken = ''
let kitchenToken = ''

beforeAll(async () => {
  adminToken = await signAccessToken(admin)
  kitchenToken = await signAccessToken(kitchen)
})

function get(path: string, token?: string) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  )
}

describe('authGuard', () => {
  test('missing token → 401 UNAUTHORIZED', async () => {
    const res = await get('/whoami')
    expect(res.status).toBe(401)
    expect(await errorCode(res)).toBe('UNAUTHORIZED')
  })

  test('malformed / non-bearer header → 401', async () => {
    const res = await app.handle(
      new Request('http://localhost/whoami', { headers: { authorization: 'Basic abc' } }),
    )
    expect(res.status).toBe(401)
  })

  test('invalid/garbage token → 401', async () => {
    const res = await get('/whoami', 'not-a-jwt')
    expect(res.status).toBe(401)
  })

  test('valid token attaches identity to context', async () => {
    const res = await get('/whoami', adminToken)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(admin)
  })

  test('correct role passes role-restricted route', async () => {
    const res = await get('/admin-only', adminToken)
    expect(res.status).toBe(200)
  })

  test('wrong role → 403 FORBIDDEN', async () => {
    const res = await get('/admin-only', kitchenToken)
    expect(res.status).toBe(403)
    expect(await errorCode(res)).toBe('FORBIDDEN')
  })
})
