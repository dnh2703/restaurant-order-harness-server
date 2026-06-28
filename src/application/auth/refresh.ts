import { eq } from 'drizzle-orm'

import { signAccessToken } from '../../infrastructure/auth/access-token'
import { generateRefreshToken, hashRefreshToken } from '../../infrastructure/auth/refresh-token'
import { env } from '../../infrastructure/config/env'
import type { Database } from '../../infrastructure/database/client'
import { refreshTokens, users } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'

export interface RefreshResult {
  accessToken: string
  refreshToken: string
}

function refreshExpiry(): Date {
  return new Date(Date.now() + env.authRefreshTokenTtlDays * 24 * 60 * 60 * 1000)
}

/** Revoke every refresh token for a user — used on logout-of-all and reuse detection. */
function revokeAllForUser(database: Database, userId: string): Promise<unknown> {
  return database
    .update(refreshTokens)
    .set({ revoked: true })
    .where(eq(refreshTokens.userId, userId))
}

/**
 * Exchange a refresh token for a new access token, rotating the refresh token (US-8.2).
 *
 * Rotation + reuse detection: each successful refresh revokes the presented token and
 * issues a new one. If a token that was already rotated away (now `revoked`) is presented
 * again, that signals theft — the legitimate client and the attacker can't both hold the
 * latest token — so we revoke the user's entire refresh-token family and reject.
 *
 * Rejections all map to 401:
 *  - unknown / already-revoked token → TOKEN_REVOKED (revoked replay also nukes the family)
 *  - expired token                   → TOKEN_EXPIRED
 *
 * Statements run in autocommit (no multi-statement transaction) to stay friendly to Neon's
 * PgBouncer transaction pooling, consistent with the rest of the app.
 */
export async function refreshUseCase(
  database: Database,
  rawRefreshToken: string,
): Promise<RefreshResult> {
  const tokenHash = hashRefreshToken(rawRefreshToken)

  const [row] = await database
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1)

  if (!row) {
    throw new AppError('TOKEN_REVOKED')
  }

  if (row.revoked) {
    // Reuse of a rotated/revoked token: treat as compromise and kill all sessions.
    await revokeAllForUser(database, row.userId)
    throw new AppError('TOKEN_REVOKED')
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    throw new AppError('TOKEN_EXPIRED')
  }

  const [user] = await database.select().from(users).where(eq(users.id, row.userId)).limit(1)
  if (!user || !user.isActive) {
    await revokeAllForUser(database, row.userId)
    throw new AppError('TOKEN_REVOKED')
  }

  // Rotate: revoke the presented token, then mint a replacement.
  await database.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.id, row.id))

  const refreshToken = generateRefreshToken()
  await database.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: refreshExpiry(),
  })

  const accessToken = await signAccessToken({
    userId: user.id,
    role: user.role,
    restaurantId: user.restaurantId,
  })

  return { accessToken, refreshToken }
}
