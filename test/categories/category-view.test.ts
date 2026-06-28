import { describe, expect, it } from 'bun:test'

import { toCategoryView } from '../../src/application/categories/category-view'

describe('toCategoryView', () => {
  it('maps a row to the admin-facing view', () => {
    const view = toCategoryView({
      id: 'cat-1',
      restaurantId: 'rest-1',
      name: 'Drinks',
      sortOrder: 3,
    })
    expect(view).toEqual({ id: 'cat-1', restaurantId: 'rest-1', name: 'Drinks', sortOrder: 3 })
  })
})
