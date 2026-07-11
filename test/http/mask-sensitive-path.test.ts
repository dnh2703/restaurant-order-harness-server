import { describe, expect, it } from 'bun:test'

import { maskSensitivePath } from '../../src/presentation/http/plugins/request-logger'

/**
 * US-025: the customer `qrToken` is the only authorization for a table's orders, so it must
 * never reach the access logs. The logged path replaces the token segment of QR routes with
 * `:qrToken`; all other paths pass through unchanged.
 */
describe('maskSensitivePath', () => {
  it('masks the token segment of QR routes', () => {
    expect(maskSensitivePath('/api/qr/abc-123-token/order')).toBe('/api/qr/:qrToken/order')
    expect(maskSensitivePath('/api/qr/abc-123-token/menu')).toBe('/api/qr/:qrToken/menu')
    expect(maskSensitivePath('/api/qr/abc-123-token/order-items')).toBe(
      '/api/qr/:qrToken/order-items',
    )
  })

  it('masks the bare QR resolve path with no trailing segment', () => {
    expect(maskSensitivePath('/api/qr/abc-123-token')).toBe('/api/qr/:qrToken')
  })

  it('never leaves the raw token anywhere in the result', () => {
    const token = 'super-secret-qr-token-value'
    expect(maskSensitivePath(`/api/qr/${token}/order`)).not.toContain(token)
  })

  it('passes non-QR paths through unchanged', () => {
    expect(maskSensitivePath('/api/kitchen/queue')).toBe('/api/kitchen/queue')
    expect(maskSensitivePath('/api/health')).toBe('/api/health')
    expect(maskSensitivePath('/api/auth/login')).toBe('/api/auth/login')
  })
})
