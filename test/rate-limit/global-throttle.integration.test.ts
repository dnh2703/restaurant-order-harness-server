import { Elysia } from 'elysia'
import { describe, expect, it } from 'bun:test'

import { createRateLimiting } from '../../src/presentation/http/plugins/rate-limit'
import { errorHandler } from '../../src/presentation/http/plugins/error-handler'

/**
 * US-023: the global per-IP limiter protects the unauthenticated / expensive routes
 * (QR reads under /api/qr/, image upload at /api/menu-items/image) and leaves other paths
 * (e.g. /api/health) untouched.
 */
function makeApp(max: number) {
  const rl = createRateLimiting({
    enabled: true,
    trustedProxyHeader: 'x-forwarded-for',
    login: { windowMs: 60_000, max: 1000 },
    global: { windowMs: 60_000, max },
  })
  return new Elysia({ prefix: '/api' })
    .use(errorHandler())
    .use(rl.globalPlugin)
    .get('/qr/:token/order', () => ({ data: 'order' }))
    .get('/health', () => ({ data: 'ok' }))
}

function get(app: Elysia, path: string, ip: string) {
  return app.handle(new Request(`http://localhost${path}`, { headers: { 'x-forwarded-for': ip } }))
}

describe('global rate limiting (integration)', () => {
  it('throttles a QR path per IP after the limit', async () => {
    const app = makeApp(2)
    expect((await get(app, '/api/qr/t1/order', '5.5.5.5')).status).toBe(200)
    expect((await get(app, '/api/qr/t1/order', '5.5.5.5')).status).toBe(200)
    const blocked = await get(app, '/api/qr/t1/order', '5.5.5.5')
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBe('60')
  })

  it('isolates IPs on the QR path', async () => {
    const app = makeApp(1)
    expect((await get(app, '/api/qr/t1/order', '5.5.5.5')).status).toBe(200)
    expect((await get(app, '/api/qr/t1/order', '5.5.5.5')).status).toBe(429)
    expect((await get(app, '/api/qr/t1/order', '6.6.6.6')).status).toBe(200) // other IP unaffected
  })

  it('does not throttle non-targeted paths like /api/health', async () => {
    const app = makeApp(1)
    expect((await get(app, '/api/health', '7.7.7.7')).status).toBe(200)
    expect((await get(app, '/api/health', '7.7.7.7')).status).toBe(200) // never throttled
  })
})
