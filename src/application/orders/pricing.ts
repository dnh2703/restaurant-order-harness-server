import { AppError } from '../../shared/errors'

/**
 * Server-authoritative pricing + validation for an order line (US-007). These functions are
 * pure (DB-free) so the money math and the cart rules are unit-testable without a database;
 * the use-case (./add-order-items) loads the menu rows and calls into here. Implements the
 * pricing/validation rules in SPEC US-3.1/US-3.2 (see docs/product/ordering.md):
 *
 * - `unit_price = menu_items.price + Σ(selected option.price_delta)` — the client never sends
 *   a price.
 * - `name_snapshot` + option snapshots are captured so later menu edits never change a placed
 *   order.
 * - Reject an unavailable item (409), a non-positive quantity (422), a selection that is not a
 *   valid option of the item / more than one in a SINGLE group (422), and a required option
 *   group with no selection (422).
 */
export interface PricingOption {
  id: string
  name: string
  priceDelta: number
}

export interface PricingOptionGroup {
  id: string
  type: 'SINGLE' | 'MULTI'
  isRequired: boolean
  options: PricingOption[]
}

export interface PricingMenuItem {
  id: string
  name: string
  price: number
  isAvailable: boolean
  optionGroups: PricingOptionGroup[]
}

/** One requested cart line. `optionIds` are the customer's chosen option ids (any order). */
export interface ItemSelection {
  menuItemId: string
  quantity: number
  note?: string | null
  optionIds?: string[]
}

export interface PricedOption {
  optionName: string
  priceDelta: number
}

/** A validated, fully-priced line ready to be persisted as an `order_item` (+ its options). */
export interface PricedItem {
  menuItemId: string
  nameSnapshot: string
  unitPrice: number
  quantity: number
  note: string | null
  options: PricedOption[]
}

/**
 * Validate one selection against its menu item and compute the priced line. Throws an
 * `AppError` (mapped to 409/422 by the HTTP error handler) on the first rule it violates;
 * checks run availability → quantity → option validity → required groups. Option snapshots
 * are emitted in the item's own group/option order (not the client's), so the result is
 * deterministic regardless of how the client ordered `optionIds`.
 */
export function priceOrderItem(item: PricingMenuItem, selection: ItemSelection): PricedItem {
  if (!item.isAvailable) {
    throw new AppError('ITEM_UNAVAILABLE', { details: { menuItemId: item.id } })
  }
  if (!Number.isInteger(selection.quantity) || selection.quantity < 1) {
    throw new AppError('INVALID_QUANTITY', { details: { menuItemId: item.id } })
  }

  const selected = new Set(selection.optionIds ?? [])
  const validIds = new Set(item.optionGroups.flatMap((g) => g.options.map((o) => o.id)))
  for (const id of selected) {
    if (!validIds.has(id)) {
      throw new AppError('INVALID_OPTION', { details: { menuItemId: item.id, optionId: id } })
    }
  }

  const options: PricedOption[] = []
  let optionsTotal = 0
  for (const group of item.optionGroups) {
    const chosen = group.options.filter((o) => selected.has(o.id))
    if (group.type === 'SINGLE' && chosen.length > 1) {
      throw new AppError('INVALID_OPTION', {
        message: 'A SINGLE option group allows at most one selection',
        details: { groupId: group.id },
      })
    }
    if (group.isRequired && chosen.length === 0) {
      throw new AppError('MISSING_REQUIRED_OPTION', { details: { groupId: group.id } })
    }
    for (const o of chosen) {
      options.push({ optionName: o.name, priceDelta: o.priceDelta })
      optionsTotal += o.priceDelta
    }
  }

  return {
    menuItemId: item.id,
    nameSnapshot: item.name,
    unitPrice: item.price + optionsTotal,
    quantity: selection.quantity,
    note: selection.note ?? null,
    options,
  }
}

/** Minimal shape needed to recompute order totals: a priced quantity and a status. */
export interface TotalsItem {
  unitPrice: number
  quantity: number
  status: 'PENDING' | 'COOKING' | 'SERVED' | 'CANCELLED'
}

export interface OrderTotals {
  subtotal: number
  total: number
}

/**
 * Recompute an order's `subtotal`/`total` from its items. `subtotal` sums `unit_price ×
 * quantity` over every non-cancelled item; `total` subtracts the order discount, floored at
 * zero. This is the canonical formula; the use-case mirrors it in a single atomic SQL UPDATE
 * (so concurrent submits converge), and the integration test ties the persisted totals back
 * to this definition.
 */
export function computeOrderTotals(items: TotalsItem[], discountAmount = 0): OrderTotals {
  const subtotal = items
    .filter((i) => i.status !== 'CANCELLED')
    .reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)
  return { subtotal, total: Math.max(0, subtotal - discountAmount) }
}
