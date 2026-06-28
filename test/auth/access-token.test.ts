import { describe, expect, test } from 'bun:test'

import { signAccessToken, verifyAccessToken } from '../../src/infrastructure/auth/access-token'

const claims = {
  userId: '11111111-1111-1111-1111-111111111111',
  role: 'ADMIN' as const,
  restaurantId: '22222222-2222-2222-2222-222222222222',
}

describe('access token (JWT) sign/verify', () => {
  test('round-trips the identity claims', async () => {
    const token = await signAccessToken(claims)
    const verified = await verifyAccessToken(token)
    expect(verified.userId).toBe(claims.userId)
    expect(verified.role).toBe(claims.role)
    expect(verified.restaurantId).toBe(claims.restaurantId)
  })

  test('rejects a tampered token', async () => {
    const token = await signAccessToken(claims)
    const tampered = `${token.slice(0, -2)}xx`
    await expect(verifyAccessToken(tampered)).rejects.toThrow()
  })

  test('rejects a token signed with a different secret', async () => {
    const token = await signAccessToken(claims, { secret: 'attacker-secret' })
    await expect(verifyAccessToken(token)).rejects.toThrow()
  })

  test('rejects an expired token', async () => {
    const token = await signAccessToken(claims, { expiresInSeconds: -1 })
    await expect(verifyAccessToken(token)).rejects.toThrow()
  })
})
