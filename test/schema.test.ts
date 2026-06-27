import { describe, expect, it } from 'bun:test'

import { getTableConfig } from 'drizzle-orm/pg-core'

import * as schema from '../src/infrastructure/database/schema'

/**
 * Unit guards for the data model (US-002). These assert the enum value sets and the
 * presence of every table without touching a database, so they catch accidental
 * drift from docs/product/data-model.md in plain `bun test`.
 */
describe('schema enums', () => {
  it('defines the documented enum value sets', () => {
    expect(schema.userRole.enumValues).toEqual(['ADMIN', 'KITCHEN', 'CASHIER'])
    expect(schema.tableStatus.enumValues).toEqual(['EMPTY', 'OCCUPIED'])
    expect(schema.optionGroupType.enumValues).toEqual(['SINGLE', 'MULTI'])
    expect(schema.orderStatus.enumValues).toEqual(['OPEN', 'PAID', 'CANCELLED'])
    expect(schema.orderItemStatus.enumValues).toEqual(['PENDING', 'COOKING', 'SERVED', 'CANCELLED'])
    expect(schema.paymentMethod.enumValues).toEqual(['CASH', 'TRANSFER', 'CARD'])
    expect(schema.serviceRequestType.enumValues).toEqual(['CALL_STAFF', 'REQUEST_BILL'])
    expect(schema.serviceRequestStatus.enumValues).toEqual(['OPEN', 'DONE'])
  })
})

describe('schema tables', () => {
  const expectedTables = [
    'restaurants',
    'users',
    'refresh_tokens',
    'tables',
    'categories',
    'menu_items',
    'option_groups',
    'options',
    'orders',
    'order_items',
    'order_item_options',
    'payments',
    'service_requests',
  ] as const

  const tableExports = {
    restaurants: () => schema.restaurants,
    users: () => schema.users,
    refresh_tokens: () => schema.refreshTokens,
    tables: () => schema.tables,
    categories: () => schema.categories,
    menu_items: () => schema.menuItems,
    option_groups: () => schema.optionGroups,
    options: () => schema.options,
    orders: () => schema.orders,
    order_items: () => schema.orderItems,
    order_item_options: () => schema.orderItemOptions,
    payments: () => schema.payments,
    service_requests: () => schema.serviceRequests,
  }

  it('exports all 13 domain tables mapped to snake_case names', () => {
    for (const name of expectedTables) {
      const table = tableExports[name]()
      expect(getTableConfig(table).name).toBe(name)
    }
  })

  it('enforces one OPEN order per table via a partial unique index', () => {
    const { indexes } = getTableConfig(schema.orders)
    const partialUnique = indexes.find((index) => index.config.unique && index.config.where)
    expect(partialUnique).toBeDefined()
    // Single-column partial unique (on table_id) — the column SQL name is resolved by
    // the snake_case casing config at query/generate time, so assert the shape here.
    expect(partialUnique?.config.columns).toHaveLength(1)
  })
})
