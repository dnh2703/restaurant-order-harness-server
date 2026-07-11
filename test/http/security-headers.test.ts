import { Elysia } from 'elysia'
import { describe, expect, it } from 'bun:test'

import { securityHeaders } from '../../src/presentation/http/plugins/security-headers'

/**
 * US-024: every response carries the baseline security headers; HSTS is added only when
 * enabled (production over TLS). Headers must be present on error responses too, so they
 * are set on the request path, not only successful handlers.
 */
function appWith(hsts: boolean) {
  return new Elysia()
    .use(securityHeaders({ hsts }))
    .get('/ok', () => 'ok')
    .get('/boom', () => {
      throw new Error('kaboom')
    })
}

describe('securityHeaders', () => {
  it('sets nosniff, frame-deny, CSP frame-ancestors, and referrer-policy on success', async () => {
    const res = await appWith(false).handle(new Request('http://localhost/ok'))
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('omits HSTS when disabled and includes it when enabled', async () => {
    const off = await appWith(false).handle(new Request('http://localhost/ok'))
    expect(off.headers.get('strict-transport-security')).toBeNull()

    const on = await appWith(true).handle(new Request('http://localhost/ok'))
    expect(on.headers.get('strict-transport-security')).toContain('max-age=')
  })

  it('sets the headers on error responses as well', async () => {
    const res = await appWith(false).handle(new Request('http://localhost/boom'))
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })
})
