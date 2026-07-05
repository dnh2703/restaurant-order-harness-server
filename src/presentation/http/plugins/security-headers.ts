import { Elysia } from 'elysia'

export interface SecurityHeadersOptions {
  /** Emit HSTS (only meaningful over TLS, i.e. production). */
  hsts: boolean
}

/**
 * Baseline security response headers (US-024 / audit 2026-07-04). Set on the request path so
 * they apply to error responses too:
 * - `X-Content-Type-Options: nosniff` — stop MIME sniffing (matters for the docs page and any
 *   served asset).
 * - `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors 'none'` — clickjacking
 *   protection for the docs UI. CSP is intentionally limited to `frame-ancestors` so it does
 *   not break the Swagger UI's own inline assets.
 * - `Referrer-Policy: no-referrer` — do not leak URLs (which include QR tokens) via Referer.
 * - `Strict-Transport-Security` — only when `hsts` is on (production over TLS).
 */
export function securityHeaders(options: SecurityHeadersOptions) {
  return new Elysia({ name: 'security-headers' }).onRequest(({ set }) => {
    set.headers['x-content-type-options'] = 'nosniff'
    set.headers['x-frame-options'] = 'DENY'
    set.headers['content-security-policy'] = "frame-ancestors 'none'"
    set.headers['referrer-policy'] = 'no-referrer'
    if (options.hsts) {
      set.headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains'
    }
  })
}
