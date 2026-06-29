# Design — US-018 Cashier & Payment

Full design rationale: `docs/superpowers/specs/2026-06-29-us-018-cashier-payment-design.md`.
Implementation plan: `docs/superpowers/plans/2026-06-29-us-018-cashier-payment.md`.

## Domain Model

Reuses existing entities — no new tables, no migration:

- `orders` (status `OPEN`/`PAID`/`CANCELLED`, `subtotal`, `discount_amount`, `discount_reason`,
  `total`, `closed_at`). Invariant: at most one `OPEN` order per table (partial unique index).
- `payments` (`order_id`, `method`, `amount`, `cashier_id`, `paid_at`).
- `tables` (status `EMPTY`/`OCCUPIED`).

Business rules: `total = max(subtotal − discount_amount, 0)`; a discount and a checkout are only
valid on an `OPEN` order; payment amount equals the order total at close-out.

## Application Flow

`src/application/cashier/`:

- `listOpenTables(db, restaurantId)` — query: `orders` ⋈ `tables` on `status='OPEN'`, with a
  correlated non-cancelled `itemCount`, ordered by `opened_at`.
- `getBill(db, restaurantId, orderId)` — query: tenant existence guard → `loadOrder`.
- `resolveDiscountAmount(subtotal, { type, value })` — pure money math; throws `INVALID_DISCOUNT`.
- `applyDiscount(db, restaurantId, orderId, input)` — command: read subtotal (tenant+OPEN) →
  compute amount → conditional UPDATE `discount_amount`/`discount_reason`/`total`.
- `checkoutOrder(db, restaurantId, orderId, { method }, cashierId)` — command: gate UPDATE
  (OPEN→PAID, RETURNING `tableId`,`total`) → insert payment → free table.
- `throwOrderGateFailure(db, restaurantId, orderId)` — shared `Promise<never>` mapping a 0-row gate
  to `404 ORDER_NOT_FOUND` (missing/cross-tenant) vs `409 ORDER_NOT_OPEN` (exists, not open).

## Interface Contract

| Method | Path | Body | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/cashier/tables` | — | `200 { data: { tables: OpenTableView[] } }` | 401/403 |
| GET | `/cashier/orders/:id` | — | `200 { data: { order } }` | 401/403, 404 ORDER_NOT_FOUND |
| PATCH | `/cashier/orders/:id/discount` | `{ type, value≥0, reason? }` | `200 { data: { order } }` | 400 (bad enum/value), 404, 409 ORDER_NOT_OPEN, 422 INVALID_DISCOUNT |
| POST | `/cashier/orders/:id/payment` | `{ method }` | `200 { data: { payment, order } }` | 400, 404, 409 ORDER_NOT_OPEN |

All guarded `['CASHIER','ADMIN']`; `restaurantId` from `auth.restaurantId`; `cashierId` from
`auth.userId`. New error codes: `ORDER_NOT_FOUND` (404), `ORDER_NOT_OPEN` (409),
`INVALID_DISCOUNT` (422).

## Data Model

No schema changes, no migration. Uses existing `payments`/`orders`/`tables` columns and the
`orders(table_id) WHERE status='OPEN'` partial unique index.

## UI / Platform Impact

Backend only. Frontend (later) renders the cashier board, bill, and invoice. Cashier polls
`/cashier/tables` (no SSE in this slice).

## Observability

`payments` rows are the durable audit of every close-out (`cashier_id`, `amount`, `paid_at`).
No new logs/metrics added.

## Concurrency Design (money-critical)

The OPEN→PAID gate is a single `UPDATE … WHERE status='OPEN' RETURNING` (mirrors the kitchen
`advance-item-status` pattern). Under Postgres READ COMMITTED, two concurrent checkouts serialize
on the row lock; the second re-evaluates `status='OPEN'` after the first commits, matches 0 rows,
and is routed to `409 ORDER_NOT_OPEN` — inserting no payment. This is the double-charge guard.
Discount uses the same tenant+OPEN conditional UPDATE so a flipped status returns 0 rows safely.

## Alternatives Considered

1. **Wrap gate + payment insert in one transaction** to close the crash window. Rejected: departs
   from the codebase's autocommit/gate pattern under Neon transaction-mode pooling. The window only
   loses an audit row (never a double charge), so gate-first was chosen; a future reconciliation
   job (or a `payments(order_id)` unique index in a migration-bearing story) is the mitigation.
2. **Client-supplied payment amount.** Rejected: amount is taken from the gate's RETURNING `total`
   so it cannot be tampered with.
