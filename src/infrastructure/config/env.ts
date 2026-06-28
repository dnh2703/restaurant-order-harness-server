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

const nodeEnv = process.env.NODE_ENV ?? 'development'
const isProduction = nodeEnv === 'production'

/**
 * The JWT signing secret. Required in production (a weak/default secret would let anyone
 * forge access tokens). Outside production we fall back to a clearly-labelled dev secret
 * so `bun test` and local runs work without extra setup.
 */
function authJwtSecret(): string {
  if (isProduction) return required('AUTH_JWT_SECRET')
  return process.env.AUTH_JWT_SECRET?.trim() || 'dev-insecure-jwt-secret-change-me'
}

export const env = {
  nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',
  port: optionalNumber('PORT', 3000),
  databaseUrl: required('DATABASE_URL'),
  databaseUrlUnpooled: required('DATABASE_URL_UNPOOLED'),
  // Auth (US-009)
  authJwtSecret: authJwtSecret(),
  // Access token lifetime in seconds (~15 min).
  authAccessTokenTtl: optionalNumber('AUTH_ACCESS_TOKEN_TTL', 900),
  // Refresh token lifetime in days.
  authRefreshTokenTtlDays: optionalNumber('AUTH_REFRESH_TOKEN_TTL_DAYS', 30),
} as const

export type Env = typeof env
