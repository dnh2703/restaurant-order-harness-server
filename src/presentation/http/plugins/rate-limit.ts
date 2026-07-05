import { Elysia } from 'elysia'

import { resolveClientIp } from '../../../infrastructure/rate-limit/client-ip'
import {
  FixedWindowRateLimiter,
  type RateLimitResult,
} from '../../../infrastructure/rate-limit/rate-limiter'
import { AppError } from '../../../shared/errors'

/**
 * Rate limiting (US-023 / decision 0023). A request may be limited by more than one key:
 * login is throttled per-IP AND per-account, so brute-forcing one victim across many IPs,
 * or many accounts from one IP, both get bounded. `evaluateRateLimit` counts every key and
 * blocks if ANY is over its limit, returning the longest retry-after.
 */
export function evaluateRateLimit(
  limiter: FixedWindowRateLimiter,
  keys: string[],
): RateLimitResult {
  let allowed = true
  let retryAfterSeconds = 0
  for (const key of keys) {
    const result = limiter.check(key)
    if (!result.allowed) {
      allowed = false
      retryAfterSeconds = Math.max(retryAfterSeconds, result.retryAfterSeconds)
    }
  }
  return { allowed, retryAfterSeconds }
}

interface EnforceInput {
  enabled: boolean
  limiter: FixedWindowRateLimiter
  keys: string[]
  set: { headers: Record<string, string | number> }
}

/**
 * Enforce a limit: on breach, set `Retry-After` and throw `TOO_MANY_REQUESTS` (429). Called
 * before the route handler runs, so a throttled request never reaches the login use-case —
 * which also means the 429 is identical whether or not the account exists (no enumeration).
 */
export function enforceRateLimit({ enabled, limiter, keys, set }: EnforceInput): void {
  if (!enabled) return
  const result = evaluateRateLimit(limiter, keys)
  if (!result.allowed) {
    set.headers['retry-after'] = String(result.retryAfterSeconds)
    throw new AppError('TOO_MANY_REQUESTS', {
      details: { retryAfterSeconds: result.retryAfterSeconds },
    })
  }
}

/** Context fields needed to derive the client IP, present on every Elysia handler context. */
interface IpContext {
  request: Request
  server: { requestIP?: (request: Request) => { address?: string } | null } | null
}

/** Derive the rate-limit client IP from an Elysia context + the configured trusted header. */
export function clientIpFromContext(ctx: IpContext, trustedHeader: string | undefined): string {
  const socketIp = ctx.server?.requestIP?.(ctx.request)?.address
  return resolveClientIp({ headers: ctx.request.headers, socketIp, trustedHeader })
}

export interface RateLimitConfig {
  enabled: boolean
  trustedProxyHeader: string | undefined
  login: { windowMs: number; max: number }
  global: { windowMs: number; max: number }
}

/**
 * Build the login + global limiters and the Elysia guards that apply them:
 * - `loginGuard`: use in the login route's `beforeHandle` (per-IP + per-account).
 * - `globalPlugin`: mount on the app; throttles the unauthenticated/expensive routes
 *   (QR reads, image upload) per-IP, matched by path prefix.
 */
export function createRateLimiting(config: RateLimitConfig) {
  const loginLimiter = new FixedWindowRateLimiter(config.login)
  const globalLimiter = new FixedWindowRateLimiter(config.global)

  const loginGuard = (
    ctx: IpContext & { body: unknown; set: { headers: Record<string, string | number> } },
  ): void => {
    const ip = clientIpFromContext(ctx, config.trustedProxyHeader)
    const email = (ctx.body as { email?: string } | undefined)?.email?.trim().toLowerCase()
    const keys = [`login:ip:${ip}`]
    if (email) keys.push(`login:acct:${email}`)
    enforceRateLimit({ enabled: config.enabled, limiter: loginLimiter, keys, set: ctx.set })
  }

  // Paths (under the app's /api prefix) that the global limiter protects.
  const GLOBAL_PREFIXES = ['/api/qr/', '/api/menu-items/image']
  const isGlobalTarget = (path: string): boolean =>
    GLOBAL_PREFIXES.some((prefix) => path.startsWith(prefix))

  const globalPlugin = new Elysia({ name: 'rate-limit-global' }).onBeforeHandle(
    { as: 'global' },
    (ctx) => {
      if (!config.enabled) return
      const path = (ctx as { path: string }).path
      if (!isGlobalTarget(path)) return
      const ip = clientIpFromContext(ctx as IpContext, config.trustedProxyHeader)
      enforceRateLimit({
        enabled: config.enabled,
        limiter: globalLimiter,
        keys: [`global:ip:${ip}`],
        set: ctx.set as { headers: Record<string, string | number> },
      })
    },
  )

  return { loginGuard, globalPlugin, loginLimiter, globalLimiter }
}
