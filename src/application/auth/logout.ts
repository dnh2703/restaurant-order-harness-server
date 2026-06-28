import { eq } from 'drizzle-orm'

import { hashRefreshToken } from '../../infrastructure/auth/refresh-token'
import type { Database } from '../../infrastructure/database/client'
import { refreshTokens } from '../../infrastructure/database/schema'

/**
 * Revoke the presented refresh token (US-8.3). Idempotent by construction: the update
 * matches on the token hash and sets `revoked = true`; an unknown or already-revoked token
 * simply affects zero/no-op rows and still returns successfully, so logout never errors.
 * We never reveal whether the token existed.
 */
export async function logoutUseCase(database: Database, rawRefreshToken: string): Promise<void> {
  await database
    .update(refreshTokens)
    .set({ revoked: true })
    .where(eq(refreshTokens.tokenHash, hashRefreshToken(rawRefreshToken)))
}
