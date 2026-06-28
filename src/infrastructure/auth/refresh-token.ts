/**
 * Refresh-token primitives (US-009). A refresh token is a high-entropy opaque value
 * handed to the client once and never stored in plaintext. The DB keeps only its
 * SHA-256 hash (`refresh_tokens.token_hash`) so a database leak does not expose a usable
 * token. Lookups hash the presented value and match on the hash.
 *
 * SHA-256 is the right primitive here (not argon2): the input is already 256 bits of
 * randomness, so there is nothing to brute-force — we need a fast, deterministic digest,
 * not a slow password hash.
 */
import { createHash, randomBytes } from 'node:crypto'

/** Generate a new opaque refresh token: 32 random bytes, base64url-encoded (43 chars). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Deterministic SHA-256 hex digest of a raw refresh token, for storage and lookup. */
export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}
