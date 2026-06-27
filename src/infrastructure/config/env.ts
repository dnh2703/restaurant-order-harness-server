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

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: optionalNumber('PORT', 3000),
  databaseUrl: required('DATABASE_URL'),
  databaseUrlUnpooled: required('DATABASE_URL_UNPOOLED'),
} as const

export type Env = typeof env
