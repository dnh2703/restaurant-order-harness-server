import { describe, expect, it } from 'bun:test'

import {
  toOptionGroupView,
  toOptionView,
} from '../../src/application/option-groups/option-group-view'

describe('toOptionView', () => {
  it('maps an option row to the admin-facing view', () => {
    expect(
      toOptionView({ id: 'opt-1', optionGroupId: 'grp-1', name: 'Large', priceDelta: 5000 }),
    ).toEqual({ id: 'opt-1', optionGroupId: 'grp-1', name: 'Large', priceDelta: 5000 })
  })

  it('preserves a negative priceDelta', () => {
    expect(
      toOptionView({ id: 'opt-2', optionGroupId: 'grp-1', name: 'Small', priceDelta: -5000 })
        .priceDelta,
    ).toBe(-5000)
  })
})

describe('toOptionGroupView', () => {
  it('maps a group plus its options, mapping each option through toOptionView', () => {
    const view = toOptionGroupView(
      { id: 'grp-1', menuItemId: 'item-1', name: 'Size', type: 'SINGLE', isRequired: true },
      [
        { id: 'opt-1', optionGroupId: 'grp-1', name: 'Large', priceDelta: 5000 },
        { id: 'opt-2', optionGroupId: 'grp-1', name: 'Small', priceDelta: 0 },
      ],
    )
    expect(view).toEqual({
      id: 'grp-1',
      menuItemId: 'item-1',
      name: 'Size',
      type: 'SINGLE',
      isRequired: true,
      options: [
        { id: 'opt-1', optionGroupId: 'grp-1', name: 'Large', priceDelta: 5000 },
        { id: 'opt-2', optionGroupId: 'grp-1', name: 'Small', priceDelta: 0 },
      ],
    })
  })

  it('yields an empty options array when the group has none', () => {
    const view = toOptionGroupView(
      { id: 'grp-2', menuItemId: 'item-1', name: 'Topping', type: 'MULTI', isRequired: false },
      [],
    )
    expect(view.options).toEqual([])
    expect(view.type).toBe('MULTI')
    expect(view.isRequired).toBe(false)
  })
})
