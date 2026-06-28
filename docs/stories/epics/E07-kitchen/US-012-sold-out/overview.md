# Overview — US-012 Temporary Sold-Out Toggle

## Current Behavior

`menu_items.is_available` exists and the customer menu (US-006) already dims/labels unavailable
dishes, but only the US-002 seed or a manual DB write can flip the flag. The kitchen cannot mark
a dish out of stock mid-service.

## Target Behavior

A `KITCHEN` (or `ADMIN`) staff member toggles a menu item's `is_available`, scoped to their own
restaurant:

- `PATCH /api/kitchen/menu-items/:id/availability` with `{ isAvailable }`.
- The item must belong to the caller's restaurant (verified via its category); otherwise
  `404 MENU_ITEM_NOT_FOUND`.
- This is the same flag admin availability uses (US-6.2); the kitchen uses it for short-term
  stockouts. The customer menu reflects the change on its next read (US-006 is a GET — there is
  no customer-menu SSE, so no realtime emission here).

## Affected Users

- `KITCHEN` — gains the sold-out toggle.
- `ADMIN` — same access.
- `Customer` — sees the item dimmed / "Sold out" on the next menu load.

## Affected Product Docs

- `docs/product/kitchen.md` (US-4.3)
- `docs/product/menu.md` (`is_available`)
- `docs/product/api-conventions.md`

## Non-Goals

- Realtime push to the customer menu (no consumer exists — YAGNI).
- Admin menu CRUD (E09).
