import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orders, tables } from '../../infrastructure/database/schema'
import { AppError, pgErrorCode } from '../../shared/errors'

/**
 * Delete a table (US-017). Tenant-scoped existence check first → `TABLE_NOT_FOUND` (404) for a
 * missing/cross-tenant id. A table referenced by ANY order (any status) is refused with
 * `TABLE_IN_USE` (409): we check first for a clean answer, and map the FK violation (SQLSTATE 23503
 * — `orders.table_id` is a non-cascading FK) to the same code so a concurrent order insert between
 * the check and the delete stays safe under Neon's transaction pooling.
 */
export async function deleteTableUseCase(
  database: Database,
  restaurantId: string,
  id: string,
): Promise<void> {
  const scope = and(eq(tables.id, id), eq(tables.restaurantId, restaurantId))

  const [current] = await database.select({ id: tables.id }).from(tables).where(scope).limit(1)
  if (!current) throw new AppError('TABLE_NOT_FOUND')

  const [open] = await database
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.tableId, id))
    .limit(1)
  if (open) throw new AppError('TABLE_IN_USE')

  try {
    await database.delete(tables).where(scope)
  } catch (error) {
    if (pgErrorCode(error) === '23503') throw new AppError('TABLE_IN_USE')
    throw error
  }
}
