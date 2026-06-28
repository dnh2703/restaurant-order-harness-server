import { asc, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { tables } from '../../infrastructure/database/schema'
import { type TableView, toTableView } from './table-view'

/**
 * List a restaurant's tables (US-017), ordered by `name`. `tables` carries its own `restaurantId`,
 * so tenancy is a direct filter — no joins (unlike US-015/US-016).
 */
export async function listTablesUseCase(
  database: Database,
  restaurantId: string,
): Promise<TableView[]> {
  const rows = await database
    .select()
    .from(tables)
    .where(eq(tables.restaurantId, restaurantId))
    .orderBy(asc(tables.name))
  return rows.map(toTableView)
}
