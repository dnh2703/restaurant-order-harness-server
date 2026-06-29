import { describe, expect, it } from 'bun:test'

import { resolveDiscountAmount } from '../../src/application/cashier/discount'

describe('resolveDiscountAmount', () => {
  it('computes a PERCENT discount as round(subtotal * value / 100)', () => {
    expect(resolveDiscountAmount(100000, { type: 'PERCENT', value: 10 })).toBe(10000)
    expect(resolveDiscountAmount(33333, { type: 'PERCENT', value: 10 })).toBe(3333) // round
  })

  it('returns a FIXED discount as the raw VND amount', () => {
    expect(resolveDiscountAmount(100000, { type: 'FIXED', value: 25000 })).toBe(25000)
  })

  it('throws INVALID_DISCOUNT for a percent over 100 or a negative value', () => {
    expect(() => resolveDiscountAmount(100000, { type: 'PERCENT', value: 101 })).toThrow(
      'out of range',
    )
    expect(() => resolveDiscountAmount(100000, { type: 'FIXED', value: -1 })).toThrow(
      'out of range',
    )
  })
})
