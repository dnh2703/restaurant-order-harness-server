/**
 * Validated runtime configuration. Read process.env exactly once, here, so the rest
 * of the app depends on a typed, validated object instead of raw strings.
 */

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, got: ${raw}`)
  }
  return parsed
}

function optionalBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  if (raw === undefined || raw === '') return fallback
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  throw new Error(`Environment variable ${name} must be a boolean (true/false), got: ${raw}`)
}

const nodeEnv = process.env.NODE_ENV ?? 'development'
const isProduction = nodeEnv === 'production'

export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  /** Public base URL images are served from, e.g. https://cdn.example.com (no trailing slash). */
  publicBaseUrl: string
}

/**
 * Cloudflare R2 storage config for dish image upload (US-021). All five keys are required
 * together in production. Outside production they are optional: when unset, `r2` is null and
 * only the image-upload endpoint fails (STORAGE_UNAVAILABLE), so `bun test` and unrelated dev
 * work need no R2 credentials (mirrors the authJwtSecret dev-fallback intent). See decision 0021.
 */
function r2Config(): R2Config | null {
  const keys = [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
    'R2_PUBLIC_BASE_URL',
  ] as const
  const values = keys.map((k) => process.env[k]?.trim())
  const present = values.filter((v) => v !== undefined && v !== '')
  if (present.length === 0) {
    if (isProduction) throw new Error(`Missing required R2 storage config: ${keys.join(', ')}`)
    return null
  }
  if (present.length !== keys.length) {
    const missing = keys.filter((_, i) => !values[i])
    throw new Error(`Incomplete R2 storage config; missing: ${missing.join(', ')}`)
  }
  // Non-null: the length check above proves all five are present, non-empty strings.
  return {
    accountId: values[0]!,
    accessKeyId: values[1]!,
    secretAccessKey: values[2]!,
    bucket: values[3]!,
    publicBaseUrl: values[4]!.replace(/\/+$/, ''),
  }
}

const ENCRYPTED_SSLMODES = new Set(['require', 'verify-ca', 'verify-full'])

/**
 * Validate that DATABASE_URL requests an encrypted connection (US-027). Outside
 * `nodeEnv === 'test'`, a `DATABASE_URL` whose `sslmode` is missing, `disable`, or `allow`
 * fails fast at startup instead of letting the pool silently connect over plaintext. Pure so
 * it is unit-testable without mutating `process.env`; CI's dummy `DATABASE_URL` (no sslmode,
 * never actually connected to) is exempted the same way the test runner exempts
 * `AUTH_JWT_SECRET`.
 */
export function resolveDatabaseUrl(nodeEnvValue: string, rawUrl: string): string {
  if (nodeEnvValue === 'test') return rawUrl
  const sslmode = new URL(rawUrl).searchParams.get('sslmode')
  if (!sslmode || !ENCRYPTED_SSLMODES.has(sslmode)) {
    throw new Error(
      'DATABASE_URL must request an encrypted connection outside tests: set sslmode=require, verify-ca, or verify-full',
    )
  }
  return rawUrl
}

/** The clearly-labelled dev fallback secret. Only ever used under the test runner. */
export const DEV_JWT_SECRET = 'dev-insecure-jwt-secret-change-me'

/**
 * Resolve the JWT signing secret (US-022). The dev fallback is reachable ONLY when
 * `nodeEnv === 'test'`, so `bun test` needs no setup. In every other environment
 * (production, staging, an unset or typo'd NODE_ENV, ...) a real `AUTH_JWT_SECRET` is
 * required and a missing/blank value throws — the process fails fast at startup rather
 * than signing forgeable tokens with the public in-repo secret. Pure so it is unit-testable
 * without mutating `process.env`.
 */
export function resolveAuthJwtSecret(nodeEnvValue: string, rawSecret: string | undefined): string {
  const trimmed = rawSecret?.trim()
  if (nodeEnvValue === 'test') return trimmed || DEV_JWT_SECRET
  if (!trimmed) throw new Error('Missing required environment variable: AUTH_JWT_SECRET')
  return trimmed
}

function authJwtSecret(): string {
  return resolveAuthJwtSecret(nodeEnv, process.env.AUTH_JWT_SECRET)
}

/**
 * Log verbosity for pino. Explicit LOG_LEVEL wins; otherwise default to a chatty
 * `debug` in development and a quieter `info` in production.
 */
function logLevel(): string {
  const raw = process.env.LOG_LEVEL?.trim()
  if (raw) return raw
  return isProduction ? 'info' : 'debug'
}

export const env = {
  nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',
  logLevel: logLevel(),
  port: optionalNumber('PORT', 3000),
  // Max request body the server accepts before rejecting (US-024). Bounds memory: oversized
  // bodies are refused by Bun.serve before the handler buffers them. Default 6 MB comfortably
  // covers the 5 MB dish image plus multipart overhead.
  maxRequestBodyBytes: optionalNumber('MAX_REQUEST_BODY_BYTES', 6_000_000),
  databaseUrl: resolveDatabaseUrl(nodeEnv, required('DATABASE_URL')),
  // Auth (US-009)
  authJwtSecret: authJwtSecret(),
  // Access token lifetime in seconds (~15 min).
  authAccessTokenTtl: optionalNumber('AUTH_ACCESS_TOKEN_TTL', 900),
  // Refresh token lifetime in days.
  authRefreshTokenTtlDays: optionalNumber('AUTH_REFRESH_TOKEN_TTL_DAYS', 30),
  // Rate limiting (US-023 / decision 0023). Disabled by default under the test runner so
  // suites that drive many requests through one (socketless) key are not throttled; on
  // everywhere else. `trustedProxyHeader` must name the header the deploy's proxy sets
  // (e.g. 'x-forwarded-for'); left unset, the socket IP is used and forwarded headers are
  // ignored (never trust a client-spoofable header by default).
  rateLimit: {
    enabled: optionalBool('RATE_LIMIT_ENABLED', nodeEnv !== 'test'),
    trustedProxyHeader: process.env.RATE_LIMIT_TRUSTED_PROXY_HEADER?.trim() || undefined,
    login: {
      windowMs: optionalNumber('AUTH_LOGIN_RATE_WINDOW_SEC', 60) * 1000,
      max: optionalNumber('AUTH_LOGIN_RATE_MAX', 10),
    },
    global: {
      windowMs: optionalNumber('GLOBAL_RATE_WINDOW_SEC', 60) * 1000,
      max: optionalNumber('GLOBAL_RATE_MAX', 120),
    },
  },
  // Storage / R2 (US-021)
  r2: r2Config(),
} as const

export type Env = typeof env
