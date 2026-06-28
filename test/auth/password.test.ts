import { describe, expect, test } from 'bun:test'

import { hashPassword, verifyPassword } from '../../src/infrastructure/auth/password'

describe('password hashing', () => {
  test('hash is not the plaintext and verifies against the right password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).not.toBe('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
  })

  test('rejects the wrong password', async () => {
    const hash = await hashPassword('s3cret')
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })

  test('verifies the seed fixture hash (argon2id, same as seed.ts)', async () => {
    // seed.ts stores `Bun.password.hash('admin-password')`; login must verify it.
    const seedStyleHash = await Bun.password.hash('admin-password')
    expect(await verifyPassword('admin-password', seedStyleHash)).toBe(true)
    expect(await verifyPassword('nope', seedStyleHash)).toBe(false)
  })
})
