import { AppError } from '../../shared/errors'

/** App-wide reporting timezone. Single-tenant-timezone assumption — see the US-019 spec. */
export const APP_TZ = 'Asia/Ho_Chi_Minh'

/** Maximum inclusive span of a report range, in days. Bounds the result size. */
export const MAX_RANGE_DAYS = 366

/** An inclusive local-date range, both ends 'YYYY-MM-DD'. */
export interface ReportRange {
  from: string
  to: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 86_400_000

/** Parse a strict 'YYYY-MM-DD' (UTC midnight); null if malformed or a rolled-over date. */
function parseLocalDate(value: string): number | null {
  if (!DATE_RE.test(value)) return null
  const ms = Date.parse(`${value}T00:00:00Z`)
  if (Number.isNaN(ms)) return null
  // Reject rollovers like 2026-02-30 (→ Mar 2): a valid date round-trips unchanged.
  if (new Date(ms).toISOString().slice(0, 10) !== value) return null
  return ms
}

/**
 * Validate a reporting date range. Both ends are inclusive local calendar dates (APP_TZ).
 * Throws INVALID_DATE_RANGE on a malformed date, from > to, or a span wider than
 * MAX_RANGE_DAYS. Pure — no DB, no wall clock.
 */
export function parseReportRange(input: { from: string; to: string }): ReportRange {
  const fromMs = parseLocalDate(input.from)
  const toMs = parseLocalDate(input.to)
  if (fromMs === null || toMs === null) throw new AppError('INVALID_DATE_RANGE')
  if (fromMs > toMs) throw new AppError('INVALID_DATE_RANGE')
  const spanDays = (toMs - fromMs) / MS_PER_DAY + 1
  if (spanDays > MAX_RANGE_DAYS) throw new AppError('INVALID_DATE_RANGE')
  return { from: input.from, to: input.to }
}
