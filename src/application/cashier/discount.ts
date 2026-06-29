import { AppError } from '../../shared/errors'

/** Discount request body shape (US-5.3). `value` is a percent (0–100) or a VND amount. */
export interface DiscountInput {
  type: 'PERCENT' | 'FIXED'
  value: number
  reason?: string | null
}

/**
 * Resolve a discount request to an absolute VND `discount_amount`. `PERCENT` → `round(subtotal *
 * value / 100)`; `FIXED` → `value`. Throws `AppError('INVALID_DISCOUNT')` (422) for a non-integer
 * or negative value, or a percent above 100. Pure (DB-free) so the money math is unit-testable.
 */
export function resolveDiscountAmount(
  subtotal: number,
  input: { type: 'PERCENT' | 'FIXED'; value: number },
): number {
  if (!Number.isInteger(input.value) || input.value < 0) {
    throw new AppError('INVALID_DISCOUNT')
  }
  if (input.type === 'PERCENT') {
    if (input.value > 100) throw new AppError('INVALID_DISCOUNT')
    return Math.round((subtotal * input.value) / 100)
  }
  return input.value
}
