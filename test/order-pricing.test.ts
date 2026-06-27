import { describe, expect, it } from 'bun:test'

import {
  computeOrderTotals,
  type PricingMenuItem,
  priceOrderItem,
} from '../src/application/orders/pricing'
import { AppError } from '../src/shared/errors'

/**
 * Unit proof for US-007 server-authoritative pricing + cart rules. Both functions are pure,
 * so unit_price computation, the snapshots, the validation rejections, and the subtotal/total
 * recompute are all proven here without a database. The append/recompute against real
 * Postgres is proven in order.test.ts.
 */
const rice: PricingMenuItem = {
  id: 'item-rice',
  name: 'Cơm tấm',
  price: 45000,
  isAvailable: true,
  optionGroups: [
    {
      id: 'grp-size',
      type: 'SINGLE',
      isRequired: true,
      options: [
        { id: 'opt-reg', name: 'Thường', priceDelta: 0 },
        { id: 'opt-large', name: 'Lớn', priceDelta: 10000 },
      ],
    },
    {
      id: 'grp-extra',
      type: 'MULTI',
      isRequired: false,
      options: [
        { id: 'opt-egg', name: 'Trứng', priceDelta: 5000 },
        { id: 'opt-pork', name: 'Sườn', priceDelta: 15000 },
      ],
    },
  ],
}

function thrownCode(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    return (error as AppError).code
  }
  throw new Error('expected priceOrderItem to throw')
}

describe('priceOrderItem', () => {
  it('computes unit_price as base price + Σ selected option deltas and snapshots them', () => {
    const line = priceOrderItem(rice, {
      menuItemId: 'item-rice',
      quantity: 2,
      note: 'no chili',
      optionIds: ['opt-large', 'opt-egg'],
    })

    expect(line.unitPrice).toBe(60000) // 45000 + 10000 + 5000
    expect(line.nameSnapshot).toBe('Cơm tấm')
    expect(line.quantity).toBe(2)
    expect(line.note).toBe('no chili')
    // Snapshots follow the item's group/option order, not the client's optionIds order.
    expect(line.options).toEqual([
      { optionName: 'Lớn', priceDelta: 10000 },
      { optionName: 'Trứng', priceDelta: 5000 },
    ])
  })

  it('defaults note to null and allows a required group satisfied by its zero-delta option', () => {
    const line = priceOrderItem(rice, {
      menuItemId: 'item-rice',
      quantity: 1,
      optionIds: ['opt-reg'],
    })

    expect(line.unitPrice).toBe(45000)
    expect(line.note).toBeNull()
    expect(line.options).toEqual([{ optionName: 'Thường', priceDelta: 0 }])
  })

  it('rejects an unavailable item with ITEM_UNAVAILABLE', () => {
    const code = thrownCode(() =>
      priceOrderItem(
        { ...rice, isAvailable: false },
        { menuItemId: 'item-rice', quantity: 1, optionIds: ['opt-reg'] },
      ),
    )
    expect(code).toBe('ITEM_UNAVAILABLE')
  })

  it('rejects a non-positive quantity with INVALID_QUANTITY', () => {
    const code = thrownCode(() =>
      priceOrderItem(rice, { menuItemId: 'item-rice', quantity: 0, optionIds: ['opt-reg'] }),
    )
    expect(code).toBe('INVALID_QUANTITY')
  })

  it('rejects a missing required option group with MISSING_REQUIRED_OPTION', () => {
    const code = thrownCode(() =>
      priceOrderItem(rice, { menuItemId: 'item-rice', quantity: 1, optionIds: [] }),
    )
    expect(code).toBe('MISSING_REQUIRED_OPTION')
  })

  it('rejects an option that does not belong to the item with INVALID_OPTION', () => {
    const code = thrownCode(() =>
      priceOrderItem(rice, {
        menuItemId: 'item-rice',
        quantity: 1,
        optionIds: ['opt-reg', 'opt-foreign'],
      }),
    )
    expect(code).toBe('INVALID_OPTION')
  })

  it('rejects more than one selection in a SINGLE group with INVALID_OPTION', () => {
    const code = thrownCode(() =>
      priceOrderItem(rice, {
        menuItemId: 'item-rice',
        quantity: 1,
        optionIds: ['opt-reg', 'opt-large'],
      }),
    )
    expect(code).toBe('INVALID_OPTION')
  })
})

describe('computeOrderTotals', () => {
  it('sums unit_price × quantity over non-cancelled items', () => {
    const totals = computeOrderTotals([
      { unitPrice: 60000, quantity: 2, status: 'PENDING' },
      { unitPrice: 5000, quantity: 3, status: 'SERVED' },
    ])
    expect(totals.subtotal).toBe(135000)
    expect(totals.total).toBe(135000)
  })

  it('excludes cancelled items and applies the discount, floored at zero', () => {
    const items = [
      { unitPrice: 60000, quantity: 1, status: 'PENDING' as const },
      { unitPrice: 99999, quantity: 1, status: 'CANCELLED' as const },
    ]
    expect(computeOrderTotals(items, 10000)).toEqual({ subtotal: 60000, total: 50000 })
    expect(computeOrderTotals(items, 1000000)).toEqual({ subtotal: 60000, total: 0 })
  })

  it('is zero for an empty order', () => {
    expect(computeOrderTotals([])).toEqual({ subtotal: 0, total: 0 })
  })
})
