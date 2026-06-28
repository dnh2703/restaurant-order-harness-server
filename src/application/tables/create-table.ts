import { randomUUID } from 'node:crypto'

import type { Database } from '../../infrastructure/database/client'
import { tables } from '../../infrastructure/database/schema'
import { type TableView, toTableView } from './table-view'

export interface CreateTableInput {
  name: string
  capacity?: number | null
}

/**
 * Create a table in the admin's restaurant (US-017). The server mints an unguessable `qrToken`
 * (`crypto.randomUUID()`); `status` defaults `EMPTY` (schema default) and is never client-set.
 * `capacity` defaults null.
 */
export async function createTableUseCase(
  database: Database,
  restaurantId: string,
  input: CreateTableInput,
): Promise<TableView> {
  const [created] = await database
    .insert(tables)
    .values({
      restaurantId,
      name: input.name,
      capacity: input.capacity ?? null,
      qrToken: randomUUID(),
    })
    .returning()
  return toTableView(created!)
}
