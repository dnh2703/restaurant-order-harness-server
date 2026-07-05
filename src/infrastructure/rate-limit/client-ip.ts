/**
 * Resolve the client IP used as a rate-limit key (US-023). Behind a proxy/CDN the socket IP
 * is the proxy, so when the deploy sets a TRUSTED forwarded header we take its left-most hop
 * (the original client). We only trust the header when it is explicitly configured — a
 * client-spoofable header must never be trusted by default. Falls back to the socket IP, and
 * finally to a stable sentinel so unknown callers fail closed into one bucket rather than
 * bypassing the limit with an empty key.
 */

export interface ClientIpInput {
  headers: Headers
  socketIp: string | undefined
  /** Configured trusted forwarded header name, or undefined to ignore forwarded headers. */
  trustedHeader: string | undefined
}

const UNKNOWN_CLIENT = 'unknown'

export function resolveClientIp({ headers, socketIp, trustedHeader }: ClientIpInput): string {
  if (trustedHeader) {
    const forwarded = headers.get(trustedHeader)
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim()
      if (first) return first
    }
  }
  return socketIp ?? UNKNOWN_CLIENT
}
