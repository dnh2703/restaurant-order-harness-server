import { describe, expect, it } from 'bun:test'

import { buildSeedData } from '../src/infrastructure/database/seed'

/**
 * The seed is the deterministic fixture every integration/E2E story builds on
 * (US-002 validation). buildSeedData is pure and DB-free so its shape is asserted
 * here; the seed() runner that hashes + inserts is exercised against a Neon branch.
 */
describe('buildSeedData', () => {
  const data = buildSeedData()

  it('builds exactly one restaurant', () => {
    expect(data.restaurant.name.length).toBeGreaterThan(0)
  })

  it('builds one ADMIN, one KITCHEN, and one CASHIER user', () => {
    expect(data.users).toHaveLength(3)
    expect(data.users.map((u) => u.role).toSorted()).toEqual(['ADMIN', 'CASHIER', 'KITCHEN'])
    // Passwords are plaintext here; the runner hashes them with Bun.password.
    for (const user of data.users) {
      expect(user.password.length).toBeGreaterThan(0)
      expect(user.email).toContain('@')
    }
  })

  it('builds 3 tables with fixed, unique qr tokens', () => {
    expect(data.tables).toHaveLength(3)
    const tokens = data.tables.map((t) => t.qrToken)
    expect(new Set(tokens).size).toBe(3)
    // Fixed tokens keep QR-resolution tests deterministic across runs.
    expect(tokens).toEqual(['qr-table-01', 'qr-table-02', 'qr-table-03'])
  })

  it('builds 2 categories holding 4 dishes total', () => {
    expect(data.categories).toHaveLength(2)
    const dishes = data.categories.flatMap((c) => c.menuItems)
    expect(dishes).toHaveLength(4)
  })

  it('gives every dish exactly one option group with at least one option', () => {
    const dishes = data.categories.flatMap((c) => c.menuItems)
    for (const dish of dishes) {
      expect(dish.price).toBeGreaterThan(0)
      expect(dish.optionGroup.options.length).toBeGreaterThan(0)
    }
  })

  it('is deterministic — repeated builds are deep-equal', () => {
    expect(buildSeedData()).toEqual(data)
  })
})
