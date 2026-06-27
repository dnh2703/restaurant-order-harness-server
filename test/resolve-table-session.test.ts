import { describe, expect, it } from 'bun:test'

import type { Database } from '../src/infrastructure/database/client'
import { resolveTableSession } from '../src/application/sessions/resolve-table-session'
import { AppError } from '../src/shared/errors'

/**
 * Unit proof for US-005 invalid-token handling. Drives the real resolveTableSession logic
 * with a minimal fake whose table lookup returns no rows, so the function must reject the
 * QR token before any order is created — no database required. The resolve-or-create and
 * concurrency paths are proven end-to-end against real Postgres in qr-session.test.ts.
 */
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

describe('resolveTableSession', () => {
  it('throws INVALID_TABLE (404) when the QR token matches no table', async () => {
    let thrown: unknown
    try {
      await resolveTableSession(fakeDbWithNoTable(), 'unknown-token')
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AppError)
    expect((thrown as AppError).code).toBe('INVALID_TABLE')
    expect((thrown as AppError).status).toBe(404)
  })
})
