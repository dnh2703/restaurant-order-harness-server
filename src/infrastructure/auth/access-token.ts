/**
 * Access-token (JWT) signing and verification (US-009). Access tokens are short-lived,
 * stateless, and verified on every staff request by `authGuard`. They carry only the
 * identity needed for authorization — `userId`, `role`, `restaurantId` — never the
 * `restaurantId` from a request body, so a token can never be used to reach another
 * tenant's data.
 *
 * Implemented with `jose` (which `@elysiajs/jwt` wraps) directly, so signing/verifying is
 * a pure, framework-agnostic function the login use-case and the guard both call, and is
 * unit-testable without an Elysia context.
 */
import { SignJWT, jwtVerify } from 'jose'

import { env } from '../config/env'

const ALG = 'HS256'

export type Role = 'ADMIN' | 'KITCHEN' | 'CASHIER'

/** The verified identity carried by an access token. */
export interface AccessTokenClaims {
  userId: string
  role: Role
  restaurantId: string
}

interface SignOptions {
  /** Override the signing secret (tests). Defaults to the configured secret. */
  secret?: string
  /** Override the lifetime in seconds (tests). Defaults to the configured TTL. */
  expiresInSeconds?: number
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

/** Sign a signed, expiring JWT carrying the identity claims. */
export async function signAccessToken(
  claims: AccessTokenClaims,
  options: SignOptions = {},
): Promise<string> {
  const ttl = options.expiresInSeconds ?? env.authAccessTokenTtl
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ role: claims.role, restaurantId: claims.restaurantId })
    .setProtectedHeader({ alg: ALG })
    .setSubject(claims.userId)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(secretKey(options.secret ?? env.authJwtSecret))
}

/**
 * Verify a JWT's signature and expiry and return its claims. Throws (jose error) on any
 * invalid, tampered, expired, or wrong-secret token; the guard maps that to a 401.
 */
export async function verifyAccessToken(
  token: string,
  options: { secret?: string } = {},
): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, secretKey(options.secret ?? env.authJwtSecret), {
    algorithms: [ALG],
  })
  return {
    userId: payload.sub as string,
    role: payload.role as Role,
    restaurantId: payload.restaurantId as string,
  }
}
