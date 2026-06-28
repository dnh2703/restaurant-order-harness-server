import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { tables } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { type TableView, toTableView } from './table-view'

export interface UpdateTableInput {
  name?: string
  capacity?: number | null
}

/**
 * Update a table (US-017). Tenant-scoped directly by `restaurantId`, so another restaurant's table
 * matches no rows → `TABLE_NOT_FOUND` (404). `status` and `qrToken` are not patchable here
 * (status is system-managed; the token changes only via regenerate). Only sent fields are patched.
 */
export async function updateTableUseCase(
  database: Database,
  restaurantId: string,
  id: string,
  input: UpdateTableInput,
): Promise<TableView> {
  const scope = and(eq(tables.id, id), eq(tables.restaurantId, restaurantId))

  const patch: Partial<{ name: string; capacity: number | null }> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.capacity !== undefined) patch.capacity = input.capacity

  if (Object.keys(patch).length === 0) {
    const [current] = await database.select().from(tables).where(scope).limit(1)
    if (!current) throw new AppError('TABLE_NOT_FOUND')
    return toTableView(current)
  }

  const [updated] = await database.update(tables).set(patch).where(scope).returning()
  if (!updated) throw new AppError('TABLE_NOT_FOUND')
  return toTableView(updated)
}
