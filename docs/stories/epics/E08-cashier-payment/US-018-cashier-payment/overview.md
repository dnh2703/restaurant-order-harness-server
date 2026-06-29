# Overview — US-018 Cashier & Payment

## Current Behavior

The ordering half of the dining loop exists. The customer QR flow opens a table's single `OPEN`
order (US-005) and appends priced items to it (US-007), which keeps `orders.subtotal`/`orders.total`
maintained on every submit. The kitchen advances items toward `SERVED` (US-011). But there is no
cashier surface: an order stays `OPEN` forever and its table stays `OCCUPIED`. There is no way to
see open tables, discount a bill, take payment, or close a session — even though the `payments`,
`orders.discount_amount`/`closed_at`, and `tables.status` columns already exist.

## Target Behavior

A `CASHIER` (or `ADMIN`), scoped to their own restaurant, gets the close-out half of the loop under
`/api/cashier` (guard `['CASHIER','ADMIN']`):

- **List open tables** (`GET /cashier/tables`) — every `OPEN` order with its table name, running
  `subtotal`/`discountAmount`/`total`, `openedAt`, and a non-cancelled `itemCount`, oldest first.
- **Bill detail** (`GET /cashier/orders/:id`) — the full order with items, unit prices, line
  totals, option snapshots, discount, and total (reuses the US-007 `loadOrder` read model).
- **Apply discount** (`PATCH /cashier/orders/:id/discount`) — `{ type: 'PERCENT'|'FIXED', value,
  reason? }`. `PERCENT` → `round(subtotal × value/100)`; `FIXED` → `value`. Recomputes
  `total = max(subtotal − discount, 0)` in the DB. Out-of-range → `422 INVALID_DISCOUNT`.
- **Finalize payment** (`POST /cashier/orders/:id/payment`) — `{ method: 'CASH'|'TRANSFER'|'CARD' }`.
  Atomically flips the order `OPEN → PAID`, records a `payment` (amount = `orders.total`, server-
  authoritative), and frees the table to `EMPTY`.

Tenancy is direct (`orders.restaurant_id`) from `auth.restaurantId`; a missing/cross-tenant id is
`404 ORDER_NOT_FOUND` (existence never disclosed). Acting on a non-`OPEN` order is
`409 ORDER_NOT_OPEN`.

## Money-safety invariants

- **No double-charge.** The `OPEN → PAID` transition is a single conditional UPDATE (the gate); at
  most one concurrent checkout wins, the loser gets `409 ORDER_NOT_OPEN` and creates no payment.
- **Server-authoritative amount.** `payments.amount = orders.total` captured at the gate; the
  client body carries only `method` — no `amount` field exists to supply.
- **Accepted trade-off.** Statements are autocommit (no multi-statement transaction — Neon
  transaction-mode pooler). A crash between the gate and the payment insert leaves a `PAID` order
  with no payment row: a lost audit record, never a double charge or wrong amount.

## Affected Users

- `CASHIER` — gains the open-tables list, bill detail, discount, and payment controls.
- `ADMIN` — same access (superset role).
- `Customer` — indirectly: a freed table re-opens a fresh order on the next QR scan (US-005).

## Affected Product Docs

- `docs/product/api-conventions.md` (new error codes, `/cashier` routes)
- SPEC EPIC 5 (US-5.1…US-5.4)

## Non-Goals

- **"Bill requested" badge** (US-5.1 AC) — needs a `service_requests` `REQUEST_BILL` writer
  (US-3.4, deferred). Added when US-3.4 lands.
- **Surcharge / additional fee** — only discounts; a surcharge would need a schema decision.
- **Cash tendered / change** — `amount = total`; tendered/change is a frontend concern.
- **Invoice render (PNG/PDF)** — backend returns bill data only.
- **Split bills / partial payment / refunds / void-after-paid** — one full payment closes the order.
- **Cashier realtime (SSE)** — cashier polls `/cashier/tables`; no order-level NOTIFY added.
