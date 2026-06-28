import { describe, expect, test } from 'bun:test'

import { generateRefreshToken, hashRefreshToken } from '../../src/infrastructure/auth/refresh-token'

describe('refresh token primitives', () => {
  test('generates a high-entropy opaque token each call', () => {
    const a = generateRefreshToken()
    const b = generateRefreshToken()
    expect(a).not.toBe(b)
    // At least 32 bytes of entropy → 43+ chars base64url.
    expect(a.length).toBeGreaterThanOrEqual(43)
  })

  test('hashes deterministically and never equals the raw value', () => {
    const raw = generateRefreshToken()
    expect(hashRefreshToken(raw)).toBe(hashRefreshToken(raw))
    expect(hashRefreshToken(raw)).not.toBe(raw)
    // SHA-256 hex is 64 chars.
    expect(hashRefreshToken(raw)).toMatch(/^[0-9a-f]{64}$/)
  })

  test('different raw tokens hash differently', () => {
    expect(hashRefreshToken(generateRefreshToken())).not.toBe(
      hashRefreshToken(generateRefreshToken()),
    )
  })
})
