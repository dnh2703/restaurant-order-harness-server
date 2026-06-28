import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { tables } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { type TableView, toTableView } from './table-view'

/**
 * Mint a fresh `qrToken` for a table (US-017 / US-1.3). The old QR stops resolving immediately
 * (`GET /api/qr/:qrToken` is an exact-match lookup). Tenant-scoped directly by `restaurantId`;
 * missing/cross-tenant → `TABLE_NOT_FOUND` (404). A `randomUUID()` collision on the `unique`
 * `qr_token` is effectively unreachable, so no dedicated conflict code is introduced.
 */
export async function regenerateQrUseCase(
  database: Database,
  restaurantId: string,
  id: string,
): Promise<TableView> {
  const scope = and(eq(tables.id, id), eq(tables.restaurantId, restaurantId))
  const [updated] = await database
    .update(tables)
    .set({ qrToken: randomUUID() })
    .where(scope)
    .returning()
  if (!updated) throw new AppError('TABLE_NOT_FOUND')
  return toTableView(updated)
}
