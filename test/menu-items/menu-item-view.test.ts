import { describe, expect, it } from 'bun:test'

import { toMenuItemView } from '../../src/application/menu-items/menu-item-view'

describe('toMenuItemView', () => {
  it('maps a row to the admin-facing view', () => {
    const view = toMenuItemView({
      id: 'item-1',
      categoryId: 'cat-1',
      name: 'Pho',
      description: 'Beef noodle soup',
      price: 50000,
      imageUrl: 'https://img/pho.jpg',
      isAvailable: true,
      sortOrder: 2,
    })
    expect(view).toEqual({
      id: 'item-1',
      categoryId: 'cat-1',
      name: 'Pho',
      description: 'Beef noodle soup',
      price: 50000,
      imageUrl: 'https://img/pho.jpg',
      isAvailable: true,
      sortOrder: 2,
    })
  })

  it('preserves null description and imageUrl', () => {
    const view = toMenuItemView({
      id: 'item-2',
      categoryId: 'cat-1',
      name: 'Water',
      description: null,
      price: 0,
      imageUrl: null,
      isAvailable: false,
      sortOrder: 0,
    })
    expect(view.description).toBeNull()
    expect(view.imageUrl).toBeNull()
    expect(view.price).toBe(0)
    expect(view.isAvailable).toBe(false)
  })
})
