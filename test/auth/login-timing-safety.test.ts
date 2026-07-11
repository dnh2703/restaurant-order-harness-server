import { describe, expect, it } from 'bun:test'

import { loginUseCase } from '../../src/application/auth/login'
import { hashPassword } from '../../src/infrastructure/auth/password'
import type { Database } from '../../src/infrastructure/database/client'

/**
 * US-028: an unknown email must pay the same argon2id verify cost as a known email with a
 * wrong password, so response timing cannot be used to enumerate valid staff emails. These
 * are unit tests against a hand-rolled fake `Database` (no real DB needed): `loginUseCase`
 * only reads via `select().from(users).where(...).limit(1)` before either path throws, so a
 * minimal chain fake is enough. Argon2id verify measured ~64ms in this environment; a 15ms
 * floor gives a wide, non-flaky margin over a bare in-memory lookup (<1ms).
 */
function fakeDb(row: unknown[]): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => row,
        }),
      }),
    }),
  } as unknown as Database
}

const TIMING_FLOOR_MS = 15

describe('loginUseCase timing safety', () => {
  it('pays an argon2id verify cost even when the email is unknown', async () => {
    const start = performance.now()
    await expect(
      loginUseCase(fakeDb([]), { email: 'nobody@example.com', password: 'whatever' }),
    ).rejects.toThrow()
    expect(performance.now() - start).toBeGreaterThan(TIMING_FLOOR_MS)
  })

  it('pays the same order of verify cost for a known email with a wrong password', async () => {
    const passwordHash = await hashPassword('correct-horse-battery-staple')
    const user = { id: 'u1', isActive: true, passwordHash, role: 'ADMIN', restaurantId: 'r1' }

    const start = performance.now()
    await expect(
      loginUseCase(fakeDb([user]), { email: 'known@example.com', password: 'wrong' }),
    ).rejects.toThrow()
    expect(performance.now() - start).toBeGreaterThan(TIMING_FLOOR_MS)
  })

  it('throws the identical INVALID_CREDENTIALS error for unknown vs. wrong-password', async () => {
    const passwordHash = await hashPassword('correct-horse-battery-staple')
    const user = { id: 'u1', isActive: true, passwordHash, role: 'ADMIN', restaurantId: 'r1' }

    const unknownError = await loginUseCase(fakeDb([]), {
      email: 'nobody@example.com',
      password: 'x',
    }).catch((error: unknown) => error)
    const wrongPasswordError = await loginUseCase(fakeDb([user]), {
      email: 'known@example.com',
      password: 'wrong',
    }).catch((error: unknown) => error)

    expect(unknownError).toMatchObject({ code: 'INVALID_CREDENTIALS' })
    expect(wrongPasswordError).toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })

  it('throws INVALID_CREDENTIALS for an inactive user even with the correct password', async () => {
    const passwordHash = await hashPassword('correct-horse-battery-staple')
    const user = { id: 'u1', isActive: false, passwordHash, role: 'ADMIN', restaurantId: 'r1' }

    await expect(
      loginUseCase(fakeDb([user]), {
        email: 'known@example.com',
        password: 'correct-horse-battery-staple',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })
})
