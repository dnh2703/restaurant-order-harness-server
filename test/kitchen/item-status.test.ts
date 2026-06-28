import { describe, expect, it } from 'bun:test'

import { assertTransition } from '../../src/application/kitchen/item-status'
import { AppError } from '../../src/shared/errors'

describe('assertTransition (forward-only PENDING→COOKING→SERVED)', () => {
  it('allows PENDING → COOKING', () => {
    expect(() => assertTransition('PENDING', 'COOKING')).not.toThrow()
  })

  it('allows COOKING → SERVED', () => {
    expect(() => assertTransition('COOKING', 'SERVED')).not.toThrow()
  })

  it.each([
    ['PENDING', 'SERVED'], // skip
    ['SERVED', 'COOKING'], // backward from terminal
    ['COOKING', 'COOKING'], // no-op
    ['SERVED', 'SERVED'], // no-op terminal
    ['CANCELLED', 'COOKING'], // from cancelled
    ['CANCELLED', 'SERVED'], // from cancelled
  ] as const)('rejects %s → %s with INVALID_TRANSITION', (from, to) => {
    let code: string | undefined
    try {
      assertTransition(from, to)
    } catch (e) {
      code = (e as AppError).code
    }
    expect(code).toBe('INVALID_TRANSITION')
  })
})
