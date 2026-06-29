import { describe, expect, it } from 'bun:test'

import { AppError } from '../../src/shared/errors'
import { MAX_RANGE_DAYS, parseReportRange } from '../../src/application/reports/date-range'

function expectInvalidRange(fn: () => unknown) {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(AppError)
    expect((e as AppError).code).toBe('INVALID_DATE_RANGE')
    return
  }
  throw new Error('expected parseReportRange to throw INVALID_DATE_RANGE')
}

describe('parseReportRange', () => {
  it('returns the inclusive range for a valid input', () => {
    expect(parseReportRange({ from: '2026-06-01', to: '2026-06-29' })).toEqual({
      from: '2026-06-01',
      to: '2026-06-29',
    })
  })

  it('accepts a single-day range (from === to)', () => {
    expect(parseReportRange({ from: '2026-06-15', to: '2026-06-15' })).toEqual({
      from: '2026-06-15',
      to: '2026-06-15',
    })
  })

  it('rejects from > to', () => {
    expectInvalidRange(() => parseReportRange({ from: '2026-06-30', to: '2026-06-01' }))
  })

  it('rejects a malformed date', () => {
    expectInvalidRange(() => parseReportRange({ from: 'nope', to: '2026-06-01' }))
  })

  it('rejects a rolled-over calendar date (2026-02-30)', () => {
    expectInvalidRange(() => parseReportRange({ from: '2026-02-30', to: '2026-03-01' }))
  })

  it(`rejects a span wider than ${MAX_RANGE_DAYS} days`, () => {
    expectInvalidRange(() => parseReportRange({ from: '2025-01-01', to: '2026-12-31' }))
  })
})
