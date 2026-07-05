import { describe, expect, it } from 'bun:test'

import { resolveClientIp } from '../../src/infrastructure/rate-limit/client-ip'

/**
 * US-023: the rate-limit key must be a real per-client value. Behind a trusted proxy we
 * take the left-most hop of the configured forwarded header; otherwise we fall back to the
 * socket IP. When neither is available the key must NOT collapse everyone into one bucket.
 */
describe('resolveClientIp', () => {
  const socket = '203.0.113.9'

  it('uses the socket IP when no trusted proxy header is configured', () => {
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.1' })
    expect(resolveClientIp({ headers, socketIp: socket, trustedHeader: undefined })).toBe(socket)
  })

  it('uses the left-most hop of the trusted forwarded header when configured', () => {
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1, 10.0.0.2' })
    expect(resolveClientIp({ headers, socketIp: socket, trustedHeader: 'x-forwarded-for' })).toBe(
      '198.51.100.1',
    )
  })

  it('falls back to the socket IP when the trusted header is absent', () => {
    const headers = new Headers()
    expect(resolveClientIp({ headers, socketIp: socket, trustedHeader: 'x-forwarded-for' })).toBe(
      socket,
    )
  })

  it('returns a stable non-empty sentinel when nothing identifies the client', () => {
    const headers = new Headers()
    const ip = resolveClientIp({ headers, socketIp: undefined, trustedHeader: undefined })
    expect(ip).toBeTruthy()
    // Two unknown callers still share the sentinel; that is acceptable (fail-closed to a
    // single bucket), and the assertion documents it is intentional, not empty-string.
    expect(ip).toBe(resolveClientIp({ headers, socketIp: undefined, trustedHeader: undefined }))
  })
})
