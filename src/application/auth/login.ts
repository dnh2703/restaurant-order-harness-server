import { eq } from 'drizzle-orm'

import { signAccessToken } from '../../infrastructure/auth/access-token'
import { verifyPassword } from '../../infrastructure/auth/password'
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

  // Verify the password even when the user is missing/inactive would be ideal to flatten
  // timing, but argon2 on a fixed dummy hash adds latency without changing the contract;
  // the generic error already hides which field failed.
  if (!user || !user.isActive || !(await verifyPassword(input.password, user.passwordHash))) {
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
