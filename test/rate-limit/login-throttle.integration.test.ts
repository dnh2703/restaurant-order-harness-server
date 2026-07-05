import { Elysia, t } from 'elysia'
import { describe, expect, it } from 'bun:test'

import { createRateLimiting } from '../../src/presentation/http/plugins/rate-limit'
import { errorHandler } from '../../src/presentation/http/plugins/error-handler'

/**
 * US-023: exercise the login throttle end-to-end through a minimal Elysia app that mounts
 * the real `loginGuard` in `beforeHandle`. The app's own limiter is disabled under the test
 * runner, so this builds its own enabled instance with small limits. IPs are driven via the
 * trusted forwarded header (no socket IP under `app.handle`).
 */
function makeApp(max: number) {
  let handlerCalls = 0
  const rl = createRateLimiting({
    enabled: true,
    trustedProxyHeader: 'x-forwarded-for',
    login: { windowMs: 60_000, max },
    global: { windowMs: 60_000, max: 1000 },
  })
  const app = new Elysia().use(errorHandler()).post(
    '/login',
    () => {
      handlerCalls += 1
      return { data: 'ok' }
    },
    { body: t.Object({ email: t.String(), password: t.String() }), beforeHandle: rl.loginGuard },
  )
  return { app, handlerCalls: () => handlerCalls }
}

function login(app: ReturnType<typeof makeApp>['app'], email: string, ip: string) {
  return app.handle(
    new Request('http://localhost/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ email, password: 'pw' }),
    }),
  )
}

describe('login rate limiting (integration)', () => {
  it('allows up to the limit then returns 429 with Retry-After from the same IP', async () => {
    const { app, handlerCalls } = makeApp(2)
    expect((await login(app, 'a@x.com', '1.1.1.1')).status).toBe(200)
    expect((await login(app, 'a@x.com', '1.1.1.1')).status).toBe(200)
    const blocked = await login(app, 'a@x.com', '1.1.1.1')
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBe('60')
    const body = (await blocked.json()) as { error: { code: string } }
    expect(body.error.code).toBe('TOO_MANY_REQUESTS')
    // The handler ran only for the two allowed attempts — the throttled one never reached it.
    expect(handlerCalls()).toBe(2)
  })

  it('throttles one account across different IPs (per-account key)', async () => {
    const { app } = makeApp(2)
    expect((await login(app, 'victim@x.com', '10.0.0.1')).status).toBe(200)
    expect((await login(app, 'victim@x.com', '10.0.0.2')).status).toBe(200)
    // Third IP, same account → account bucket is now over the limit.
    expect((await login(app, 'victim@x.com', '10.0.0.3')).status).toBe(429)
  })

  it('does not throttle a different account from a fresh IP', async () => {
    const { app } = makeApp(2)
    await login(app, 'a@x.com', '1.1.1.1')
    await login(app, 'a@x.com', '1.1.1.1')
    expect((await login(app, 'a@x.com', '1.1.1.1')).status).toBe(429) // a@x is blocked
    expect((await login(app, 'b@x.com', '2.2.2.2')).status).toBe(200) // b@x from new IP is fine
  })

  it('returns an identical 429 whether or not the account exists (no enumeration)', async () => {
    const { app } = makeApp(1)
    // Same IP, exhaust the IP bucket; the second call is throttled before the handler,
    // so an existing vs non-existing email is indistinguishable at this layer.
    await login(app, 'real@x.com', '9.9.9.9')
    const blocked = await login(app, 'does-not-exist@x.com', '9.9.9.9')
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBe('60')
  })
})
