import { describe, expect, it } from 'bun:test'

import { resolveDatabaseUrl } from '../../src/infrastructure/config/env'

const url = (sslmode?: string) =>
  `postgresql://user:pass@host/db${sslmode ? `?sslmode=${sslmode}` : ''}`

/**
 * US-027: outside NODE_ENV=test, DATABASE_URL must request an encrypted connection
 * (sslmode=require|verify-ca|verify-full) or the resolver throws (fail-fast), so a
 * misconfigured deploy can never silently connect to Postgres over plaintext.
 */
describe('resolveDatabaseUrl', () => {
  it('passes any DATABASE_URL through unchanged under NODE_ENV=test', () => {
    expect(resolveDatabaseUrl('test', url())).toBe(url())
    expect(resolveDatabaseUrl('test', url('disable'))).toBe(url('disable'))
  })

  it('accepts require, verify-ca, and verify-full outside tests', () => {
    for (const nodeEnv of ['production', 'staging', 'development', '']) {
      for (const sslmode of ['require', 'verify-ca', 'verify-full']) {
        expect(resolveDatabaseUrl(nodeEnv, url(sslmode))).toBe(url(sslmode))
      }
    }
  })

  it('throws outside tests when sslmode is missing, disable, or allow', () => {
    for (const nodeEnv of ['production', 'staging', 'development', '']) {
      expect(() => resolveDatabaseUrl(nodeEnv, url())).toThrow('DATABASE_URL')
      expect(() => resolveDatabaseUrl(nodeEnv, url('disable'))).toThrow('DATABASE_URL')
      expect(() => resolveDatabaseUrl(nodeEnv, url('allow'))).toThrow('DATABASE_URL')
    }
  })
})
