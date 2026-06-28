# Overview — US-011 Kitchen Queue & Status Transition

## Current Behavior

Customers can submit `order_items` (US-007), which land `PENDING`, and the customer can watch
them over SSE (US-008). But the kitchen has no surface: no way to see the make-queue and no way
to advance a dish toward done.

## Target Behavior

A `KITCHEN` (or `ADMIN`) staff member, scoped to their own restaurant:

- Reads the make-queue — all `PENDING` + `COOKING` items across the restaurant's orders, oldest
  first, each card carrying table name, dish name snapshot, quantity, note, and chosen options.
- Advances an item's status forward only: `PENDING → COOKING → SERVED`. Illegal steps (backward,
  skipping, from a terminal state) are rejected `409 INVALID_TRANSITION`. An item outside the
  caller's restaurant is `404 NOT_FOUND`.

Each status write rides the existing `order_items` NOTIFY trigger, so the customer stream (US-008)
and the staff stream (US-013) update with no extra publish code.

## Affected Users

- `KITCHEN` — gains the queue and status controls.
- `ADMIN` — same access (superset role).
- `Customer` — sees live `PENDING → COOKING → SERVED` via US-008.

## Affected Product Docs

- `docs/product/kitchen.md` (US-4.1, US-4.2)
- `docs/product/realtime.md`
- `docs/product/api-conventions.md`

## Non-Goals

- Item cancellation (`CANCELLED`) — transitions are forward-only by design.
- The staff restaurant-wide stream (US-013) and sold-out toggle (US-012) — separate stories.
