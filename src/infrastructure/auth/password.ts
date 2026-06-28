/**
 * Password hashing (US-009). Thin wrapper over Bun's native `Bun.password`, which uses
 * argon2id by default — the memory-hard hash the auth spec prefers. Centralising it here
 * keeps the algorithm choice in one place and matches `seed.ts`, which hashes fixture
 * passwords with the same primitive. Plaintext passwords are never stored or logged.
 */

/** Hash a plaintext password with argon2id. */
export function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain)
}

/**
 * Verify a plaintext password against a stored hash. Returns false (never throws) on a
 * mismatch, so callers can branch on the boolean without try/catch.
 */
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return Bun.password.verify(plain, hash)
}
