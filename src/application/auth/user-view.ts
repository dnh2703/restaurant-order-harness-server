import type { Role } from '../../infrastructure/auth/access-token'

/**
 * The safe, client-facing shape of a staff user. Deliberately excludes `passwordHash` and
 * any other sensitive column so a use-case can never leak it through an HTTP response.
 */
export interface PublicUser {
  id: string
  email: string
  name: string
  role: Role
  restaurantId: string
}

export function toPublicUser(row: {
  id: string
  email: string
  name: string
  role: Role
  restaurantId: string
}): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    restaurantId: row.restaurantId,
  }
}
