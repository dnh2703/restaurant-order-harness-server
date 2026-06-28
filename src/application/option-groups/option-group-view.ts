/**
 * Admin-facing shapes for a dish's option tree (US-016). An `OptionGroupView` carries its
 * `menuItemId` (tenancy flows through the item → category → restaurant; the tables have no
 * `restaurantId`) and nests its options. Nothing here is sensitive. `priceDelta` may be negative
 * (e.g. a smaller size), so it is a plain signed integer added to the menu item price.
 */
export interface OptionView {
  id: string
  optionGroupId: string
  name: string
  priceDelta: number
}

export interface OptionGroupView {
  id: string
  menuItemId: string
  name: string
  type: 'SINGLE' | 'MULTI'
  isRequired: boolean
  options: OptionView[]
}

export function toOptionView(row: {
  id: string
  optionGroupId: string
  name: string
  priceDelta: number
}): OptionView {
  return {
    id: row.id,
    optionGroupId: row.optionGroupId,
    name: row.name,
    priceDelta: row.priceDelta,
  }
}

export function toOptionGroupView(
  group: {
    id: string
    menuItemId: string
    name: string
    type: 'SINGLE' | 'MULTI'
    isRequired: boolean
  },
  optionRows: Array<{ id: string; optionGroupId: string; name: string; priceDelta: number }>,
): OptionGroupView {
  return {
    id: group.id,
    menuItemId: group.menuItemId,
    name: group.name,
    type: group.type,
    isRequired: group.isRequired,
    options: optionRows.map(toOptionView),
  }
}
