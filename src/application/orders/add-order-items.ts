import { and, eq, inArray, sql } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import {
  categories,
  menuItems,
  optionGroups,
  options,
  orderItemOptions,
  orderItems,
  orders,
} from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { loadOrder, type OrderView } from './get-order'
import { ensureOpenOrder } from './order-session'
import {
  type ItemSelection,
  type PricingMenuItem,
  type PricingOptionGroup,
  priceOrderItem,
} from './pricing'

/** Cart submitted by the customer: one or more lines appended to the table's OPEN order. */
export interface AddOrderItemsInput {
  items: ItemSelection[]
}

/**
 * Load the requested menu items (scoped to `restaurantId`) with their option groups + options,
 * assembled into the pricing shape and keyed by id. Three explicit-column reads — no N+1, no
 * `SELECT *`. Items from another restaurant simply do not appear, so the caller rejects them as
 * not found (no cross-restaurant ordering).
 */
async function loadPricingItems(
  database: Database,
  restaurantId: string,
  menuItemIds: string[],
): Promise<Map<string, PricingMenuItem>> {
  const itemRows = await database
    .select({
      id: menuItems.id,
      name: menuItems.name,
      price: menuItems.price,
      isAvailable: menuItems.isAvailable,
    })
    .from(menuItems)
    .innerJoin(categories, eq(menuItems.categoryId, categories.id))
    .where(and(eq(categories.restaurantId, restaurantId), inArray(menuItems.id, menuItemIds)))

  const loadedIds = itemRows.map((i) => i.id)
  const groupRows = loadedIds.length
    ? await database
        .select({
          id: optionGroups.id,
          menuItemId: optionGroups.menuItemId,
          type: optionGroups.type,
          isRequired: optionGroups.isRequired,
        })
        .from(optionGroups)
        .where(inArray(optionGroups.menuItemId, loadedIds))
    : []

  const groupIds = groupRows.map((g) => g.id)
  const optionRows = groupIds.length
    ? await database
        .select({
          id: options.id,
          optionGroupId: options.optionGroupId,
          name: options.name,
          priceDelta: options.priceDelta,
        })
        .from(options)
        .where(inArray(options.optionGroupId, groupIds))
    : []

  const optionsByGroup = new Map<string, PricingOptionGroup['options']>()
  for (const o of optionRows) {
    const list = optionsByGroup.get(o.optionGroupId) ?? []
    list.push({ id: o.id, name: o.name, priceDelta: o.priceDelta })
    optionsByGroup.set(o.optionGroupId, list)
  }

  const groupsByItem = new Map<string, PricingOptionGroup[]>()
  for (const g of groupRows) {
    const list = groupsByItem.get(g.menuItemId) ?? []
    list.push({
      id: g.id,
      type: g.type,
      isRequired: g.isRequired,
      options: optionsByGroup.get(g.id) ?? [],
    })
    groupsByItem.set(g.menuItemId, list)
  }

  return new Map(itemRows.map((i) => [i.id, { ...i, optionGroups: groupsByItem.get(i.id) ?? [] }]))
}

/**
 * Recompute and persist an order's totals in a single atomic UPDATE: `subtotal` is summed from
 * the order's non-cancelled items and `total = max(subtotal - discount, 0)`. Doing it in one
 * statement (rather than read-then-write) means concurrent submits to the same order always
 * converge to the correct totals. Mirrors `computeOrderTotals` in ./pricing.
 */
async function recomputeOrderTotals(database: Database, orderId: string): Promise<void> {
  const subtotal = sql<number>`COALESCE((
    SELECT SUM(${orderItems.unitPrice} * ${orderItems.quantity})
    FROM ${orderItems}
    WHERE ${orderItems.orderId} = ${orderId} AND ${orderItems.status} <> 'CANCELLED'
  ), 0)`
  await database
    .update(orders)
    .set({ subtotal, total: sql`GREATEST(${subtotal} - ${orders.discountAmount}, 0)` })
    .where(eq(orders.id, orderId))
}

/**
 * Append the submitted cart lines to the table's OPEN order (US-007, SPEC US-3.1/US-3.2).
 * Each line is priced server-side and stored `PENDING` with a `name_snapshot`, server-computed
 * `unit_price`, and option snapshots; the order totals are then recomputed. Re-submitting in the
 * same session appends to the same OPEN order (it is never replaced, and no second order opens).
 *
 * The whole cart is validated/priced before any write, so an invalid line (unavailable item,
 * bad quantity, missing/invalid option, or an unknown/cross-restaurant item) rejects the entire
 * submit with nothing inserted — atomic rejection without a multi-statement transaction. The
 * writes themselves are autocommit single statements (one batched item insert, one batched
 * option insert, one totals update), keeping lock windows short on Neon's transaction-mode
 * pooler. Returns the updated order with all its items + statuses.
 */
export async function addOrderItems(
  database: Database,
  qrToken: string,
  input: AddOrderItemsInput,
): Promise<OrderView> {
  const { orderId, restaurantId } = await ensureOpenOrder(database, qrToken)

  const requestedIds = [...new Set(input.items.map((i) => i.menuItemId))]
  const itemsById = await loadPricingItems(database, restaurantId, requestedIds)

  const priced = input.items.map((selection) => {
    const menuItem = itemsById.get(selection.menuItemId)
    if (!menuItem) {
      throw new AppError('MENU_ITEM_NOT_FOUND', { details: { menuItemId: selection.menuItemId } })
    }
    return priceOrderItem(menuItem, selection)
  })

  const insertedItems = await database
    .insert(orderItems)
    .values(
      priced.map((p) => ({
        orderId,
        menuItemId: p.menuItemId,
        nameSnapshot: p.nameSnapshot,
        unitPrice: p.unitPrice,
        quantity: p.quantity,
        note: p.note,
      })),
    )
    .returning({ id: orderItems.id })

  const optionValues = priced.flatMap((p, idx) =>
    p.options.map((o) => ({
      orderItemId: insertedItems[idx]!.id,
      optionName: o.optionName,
      priceDelta: o.priceDelta,
    })),
  )
  if (optionValues.length > 0) {
    await database.insert(orderItemOptions).values(optionValues)
  }

  await recomputeOrderTotals(database, orderId)

  return loadOrder(database, orderId)
}
