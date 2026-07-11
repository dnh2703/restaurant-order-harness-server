import { eq } from 'drizzle-orm'

import { signAccessToken } from '../../infrastructure/auth/access-token'
import { hashPassword, verifyPassword } from '../../infrastructure/auth/password'
import { generateRefreshToken, hashRefreshToken } from '../../infrastructure/auth/refresh-token'
import type { Database } from '../../infrastructure/database/client'
import { refreshTokens, users } from '../../infrastructure/database/schema'
import { env } from '../../infrastructure/config/env'
import { AppError } from '../../shared/errors'
import { type PublicUser, toPublicUser } from './user-view'

export interface LoginResult {
  accessToken: string
  refreshToken: string
  user: PublicUser
}

function refreshExpiry(): Date {
  return new Date(Date.now() + env.authRefreshTokenTtlDays * 24 * 60 * 60 * 1000)
}

// US-028: computed once at module load so every login attempt pays the same argon2id cost
// whether or not the account exists. Without this, an unknown email short-circuits before
// ever hashing, and the timing difference lets an attacker enumerate valid staff emails
// even though the response body is identical.
const dummyPasswordHash = hashPassword(`dummy-${crypto.randomUUID()}`)

/**
 * Authenticate staff by email + password (US-8.1). On success: issue a short-lived JWT
 * access token and a random refresh token whose hash is persisted (the raw value is
 * returned once and never stored). On any failure — unknown email, inactive account, or
 * wrong password — throw the same generic `INVALID_CREDENTIALS` so the response never
 * reveals which field was wrong.
 */
export async function loginUseCase(
  database: Database,
  input: { email: string; password: string },
): Promise<LoginResult> {
  const [user] = await database.select().from(users).where(eq(users.email, input.email)).limit(1)

  // Always verify against a real hash (the user's, or a fixed dummy one) so response timing
  // does not reveal whether the email exists (US-028). The generic error below still hides
  // which field failed.
  const passwordOk = await verifyPassword(
    input.password,
    user?.passwordHash ?? (await dummyPasswordHash),
  )

  if (!user || !user.isActive || !passwordOk) {
    throw new AppError('INVALID_CREDENTIALS')
  }

  const accessToken = await signAccessToken({
    userId: user.id,
    role: user.role,
    restaurantId: user.restaurantId,
  })

  const refreshToken = generateRefreshToken()
  await database.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: refreshExpiry(),
  })

  return { accessToken, refreshToken, user: toPublicUser(user) }
}
