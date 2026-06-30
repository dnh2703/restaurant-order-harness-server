# Overview — US-020 Kitchen Served-Recent

## Status

implemented

## Lane

normal

## Product Contract

Kitchen staff can see the dishes that were recently marked `SERVED`, so a served
card can remain visible briefly after leaving the active queue.

## Target Behavior

`GET /api/kitchen/served-recent` returns the authenticated restaurant's served
items from the last 30 minutes, newest first, capped at 50 cards.

Every route is guarded by `authGuard` + `.guard({ auth: ['KITCHEN', 'ADMIN'] })`.
`CASHIER` receives `403 FORBIDDEN`; missing auth receives `401 UNAUTHORIZED`.
Tenant scope comes from `auth.restaurantId` through the `orders` join.

## Design Notes

- `drizzle/0003_wandering_hannibal_king.sql` adds `order_items.served_at` plus
  an index for recent served reads.
- `advanceItemStatus` stamps `served_at` only when an item advances to `SERVED`.
- `getServedRecent` reads explicit columns, joins `orders` and `tables`, fetches
  option snapshots in one second query, and stitches them in memory.
- Legacy `SERVED` rows with `served_at = null` are excluded by the time-window
  predicate.

## Validation

See `validation.md`.

## Non-Goals

- Customer-facing history UI.
- Configurable served-recent window or page size.
- Realtime push for the recent-served panel.
