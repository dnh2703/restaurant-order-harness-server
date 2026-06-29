import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orders } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'

/**
 * Map a 0-row result from a tenant + `status='OPEN'` conditional UPDATE to the right error: a
 * tenant-scoped read tells us whether the order is missing/cross-tenant (`ORDER_NOT_FOUND`, 404)
 * or simply not OPEN (`ORDER_NOT_OPEN`, 409). Always throws — return type is `never`.
 */
export async function throwOrderGateFailure(
  database: Database,
  restaurantId: string,
  orderId: string,
): Promise<never> {
  const [row] = await database
    .select({ status: orders.status })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.restaurantId, restaurantId)))
    .limit(1)
  if (!row) throw new AppError('ORDER_NOT_FOUND')
  throw new AppError('ORDER_NOT_OPEN')
}
