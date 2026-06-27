import { describe, expect, it } from 'bun:test'

import type { Database } from '../src/infrastructure/database/client'
import {
  type CategoryRow,
  getMenuForQrToken,
  groupMenu,
  type MenuItemRow,
  type OptionGroupRow,
  type OptionRow,
} from '../src/application/menu/get-menu'
import { AppError } from '../src/shared/errors'

/**
 * Unit proof for US-006 menu assembly. `groupMenu` is pure (no DB), so the grouping, the
 * sort-order preservation, the option nesting, and the sold-out flag are all proven here.
 * The invalid-token rejection is proven with a fake whose table lookup returns no rows.
 * The seeded grouped read + cross-restaurant scoping are proven against real Postgres in
 * menu.test.ts.
 */
const categoryRows: CategoryRow[] = [
  { id: 'cat-mains', name: 'Mains' },
  { id: 'cat-drinks', name: 'Drinks' },
  { id: 'cat-empty', name: 'Specials' },
]

const itemRows: MenuItemRow[] = [
  {
    id: 'item-rice',
    categoryId: 'cat-mains',
    name: 'Cơm tấm',
    description: 'Broken rice',
    price: 45000,
    imageUrl: 'https://img/rice.png',
    isAvailable: true,
  },
  {
    id: 'item-pho',
    categoryId: 'cat-mains',
    name: 'Phở bò',
    description: null,
    price: 50000,
    imageUrl: null,
    isAvailable: false,
  },
  {
    id: 'item-tea',
    categoryId: 'cat-drinks',
    name: 'Trà đá',
    description: 'Iced tea',
    price: 5000,
    imageUrl: null,
    isAvailable: true,
  },
]

const groupRows: OptionGroupRow[] = [
  { id: 'grp-size', menuItemId: 'item-rice', name: 'Size', type: 'SINGLE', isRequired: true },
  { id: 'grp-top', menuItemId: 'item-pho', name: 'Topping', type: 'MULTI', isRequired: false },
]

const optionRows: OptionRow[] = [
  { id: 'opt-reg', optionGroupId: 'grp-size', name: 'Thường', priceDelta: 0 },
  { id: 'opt-large', optionGroupId: 'grp-size', name: 'Lớn', priceDelta: 10000 },
  { id: 'opt-egg', optionGroupId: 'grp-top', name: 'Trứng', priceDelta: 5000 },
]

describe('groupMenu', () => {
  const menu = groupMenu(categoryRows, itemRows, groupRows, optionRows)

  it('preserves the category input order and keeps empty categories', () => {
    expect(menu.categories.map((c) => c.id)).toEqual(['cat-mains', 'cat-drinks', 'cat-empty'])
    const specials = menu.categories.find((c) => c.id === 'cat-empty')
    expect(specials?.items).toEqual([])
  })

  it('groups dishes under their category in input order', () => {
    const mains = menu.categories.find((c) => c.id === 'cat-mains')
    expect(mains?.items.map((i) => i.id)).toEqual(['item-rice', 'item-pho'])
    const drinks = menu.categories.find((c) => c.id === 'cat-drinks')
    expect(drinks?.items.map((i) => i.id)).toEqual(['item-tea'])
  })

  it('carries the sold-out flag and nullable fields through', () => {
    const pho = menu.categories.flatMap((c) => c.items).find((i) => i.id === 'item-pho')
    expect(pho?.isAvailable).toBe(false)
    expect(pho?.description).toBeNull()
    expect(pho?.imageUrl).toBeNull()
  })

  it('nests option groups and their options under each dish', () => {
    const rice = menu.categories.flatMap((c) => c.items).find((i) => i.id === 'item-rice')
    expect(rice?.optionGroups).toHaveLength(1)
    const size = rice?.optionGroups[0]
    expect(size?.name).toBe('Size')
    expect(size?.isRequired).toBe(true)
    expect(size?.options.map((o) => o.name)).toEqual(['Thường', 'Lớn'])
    expect(size?.options.map((o) => o.priceDelta)).toEqual([0, 10000])
  })

  it('leaves a dish with no option groups as an empty array', () => {
    const tea = menu.categories.flatMap((c) => c.items).find((i) => i.id === 'item-tea')
    expect(tea?.optionGroups).toEqual([])
  })
})

function fakeDbWithNoTable(): Database {
  const emptyLookup = {
    from: () => emptyLookup,
    where: () => emptyLookup,
    limit: async () => [] as unknown[],
  }
  return {
    select: () => emptyLookup,
  } as unknown as Database
}

describe('getMenuForQrToken', () => {
  it('throws INVALID_TABLE (404) when the QR token matches no table', async () => {
    let thrown: unknown
    try {
      await getMenuForQrToken(fakeDbWithNoTable(), 'unknown-token')
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AppError)
    expect((thrown as AppError).code).toBe('INVALID_TABLE')
    expect((thrown as AppError).status).toBe(404)
  })
})
