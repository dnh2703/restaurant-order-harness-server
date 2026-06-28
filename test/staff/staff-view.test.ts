import { describe, expect, test } from 'bun:test'

import { toStaffView } from '../../src/application/staff/staff-view'

describe('toStaffView', () => {
  test('maps the admin-facing fields and never leaks the password hash', () => {
    const view = toStaffView({
      id: 'u1',
      email: 'cook@example.test',
      name: 'Cook',
      role: 'KITCHEN',
      restaurantId: 'r1',
      isActive: true,
      // An extra column on the row (e.g. passwordHash) must not pass through.
      passwordHash: 'argon2id$secret',
    } as never)

    expect(view).toEqual({
      id: 'u1',
      email: 'cook@example.test',
      name: 'Cook',
      role: 'KITCHEN',
      restaurantId: 'r1',
      isActive: true,
    })
    expect(view).not.toHaveProperty('passwordHash')
  })
})
