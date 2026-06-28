import type { Role } from '../../infrastructure/auth/access-token'
import { hashPassword } from '../../infrastructure/auth/password'
import type { Database } from '../../infrastructure/database/client'
import { users } from '../../infrastructure/database/schema'
import { AppError, pgErrorCode } from '../../shared/errors'
import { type StaffView, toStaffView } from './staff-view'

export interface CreateStaffInput {
  email: string
  password: string
  name: string
  role: Role
}

/**
 * Create a staff member in the admin's restaurant (US-010). The initial password is hashed
 * (argon2id) before storage; the plaintext is never persisted. `restaurantId` comes from the
 * authenticated admin's claims, never the request body. Email is globally unique — a
 * duplicate surfaces as a `23505` unique violation which maps to `EMAIL_TAKEN` (409).
 */
export async function createStaffUseCase(
  database: Database,
  restaurantId: string,
  input: CreateStaffInput,
): Promise<StaffView> {
  const passwordHash = await hashPassword(input.password)

  try {
    const [created] = await database
      .insert(users)
      .values({
        restaurantId,
        email: input.email,
        passwordHash,
        name: input.name,
        role: input.role,
      })
      .returning()
    return toStaffView(created!)
  } catch (error) {
    if (pgErrorCode(error) === '23505') {
      throw new AppError('EMAIL_TAKEN')
    }
    throw error
  }
}
