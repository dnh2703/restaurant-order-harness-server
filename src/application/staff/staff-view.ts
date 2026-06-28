import type { Role } from '../../infrastructure/auth/access-token'

/**
 * Admin-facing shape of a staff user (US-010). Like the auth `PublicUser` but also exposes
 * `isActive`, which an admin needs to manage accounts. Deliberately excludes `passwordHash`
 * so a use-case can never leak it through an HTTP response.
 */
export interface StaffView {
  id: string
  email: string
  name: string
  role: Role
  restaurantId: string
  isActive: boolean
}

export function toStaffView(row: {
  id: string
  email: string
  name: string
  role: Role
  restaurantId: string
  isActive: boolean
}): StaffView {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    restaurantId: row.restaurantId,
    isActive: row.isActive,
  }
}
