import { describe, expect, it } from 'bun:test'

import { DEV_JWT_SECRET, resolveAuthJwtSecret } from '../../src/infrastructure/config/env'

/**
 * US-022: the known dev fallback secret must be reachable ONLY under the test runner.
 * Every other environment must supply AUTH_JWT_SECRET or the resolver throws (fail-fast),
 * so a misconfigured NODE_ENV can never sign tokens with the public in-repo secret.
 */
describe('resolveAuthJwtSecret', () => {
  it('uses the dev fallback under NODE_ENV=test when no secret is set', () => {
    expect(resolveAuthJwtSecret('test', undefined)).toBe(DEV_JWT_SECRET)
    expect(resolveAuthJwtSecret('test', '')).toBe(DEV_JWT_SECRET)
    expect(resolveAuthJwtSecret('test', '   ')).toBe(DEV_JWT_SECRET)
  })

  it('uses the supplied secret verbatim when set, in any environment', () => {
    expect(resolveAuthJwtSecret('test', 'real-secret')).toBe('real-secret')
    expect(resolveAuthJwtSecret('production', 'real-secret')).toBe('real-secret')
    expect(resolveAuthJwtSecret('staging', 'real-secret')).toBe('real-secret')
    expect(resolveAuthJwtSecret('development', 'real-secret')).toBe('real-secret')
  })

  it('trims a supplied secret', () => {
    expect(resolveAuthJwtSecret('production', '  padded  ')).toBe('padded')
  })

  it('throws when the secret is missing outside tests (production, staging, unset, typo)', () => {
    for (const nodeEnv of ['production', 'staging', 'prod', 'development', '']) {
      expect(() => resolveAuthJwtSecret(nodeEnv, undefined)).toThrow('AUTH_JWT_SECRET')
      expect(() => resolveAuthJwtSecret(nodeEnv, '')).toThrow('AUTH_JWT_SECRET')
      expect(() => resolveAuthJwtSecret(nodeEnv, '   ')).toThrow('AUTH_JWT_SECRET')
    }
  })

  it('never returns the dev fallback outside NODE_ENV=test', () => {
    // Even a caller that passes the literal dev string in prod is fine (it is a real,
    // explicitly-supplied value); what must never happen is the resolver *inventing* it.
    expect(() => resolveAuthJwtSecret('production', undefined)).toThrow()
    expect(resolveAuthJwtSecret('development', 'x')).not.toBe(DEV_JWT_SECRET)
  })
})
