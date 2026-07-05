import { describe, expect, it } from 'bun:test'

import { app } from '../../src/presentation/http/app'

/**
 * US-024: the composed app carries the security headers, and — under the test runner (not
 * production) — the OpenAPI docs remain available. Production docs-gating is covered by a
 * separate boot smoke (the app reads env once at load, so it cannot be toggled in-process).
 */
describe('app hardening (integration)', () => {
  it('sets security headers on a normal response', async () => {
    const res = await app.handle(new Request('http://localhost/api/health'))
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })

  it('does not emit HSTS outside production', async () => {
    const res = await app.handle(new Request('http://localhost/api/health'))
    expect(res.headers.get('strict-transport-security')).toBeNull()
  })

  it('serves the OpenAPI docs in the (non-production) test env', async () => {
    const res = await app.handle(new Request('http://localhost/api/docs'))
    expect(res.status).toBe(200)
  })
})
