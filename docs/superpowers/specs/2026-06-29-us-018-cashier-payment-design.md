# US-018 Cashier & Payment — Design (high-risk · money)

**Epic:** E08 Cashier & Payment · **Date:** 2026-06-29 · **Depends on:** US-005 QR → open order (merged), US-007 add + submit order (merged), US-009 auth + RBAC guard (merged)

Covers SPEC EPIC 5 in one cohesive slice: **US-5.1** open-tables list, **US-5.2** bill detail, **US-5.3** discount, **US-5.4** finalize payment + close session.

## Goal

Give a `CASHIER` (and `ADMIN`) the close-out half of the dining loop: see every table that
currently has an open order with its running total, open a bill's detail, apply a discount, and
**finalize payment** — which records a `payment`, flips the order `OPEN → PAID`, and frees the
table back to `EMPTY`. Money math is server-authoritative; the close-out is concurrency-safe so a
double-submit can never produce two payments. Scoped to the staff member's own restaurant via
`auth.restaurantId`.

## Current Behavior

The ordering half exists: `ensureOpenOrder`/`addOrderItems` (US-007) open a table's single `OPEN`
order and maintain `orders.subtotal`/`orders.total` on every submit (`recomputeOrderTotals`, where
`total = max(subtotal − discountAmount, 0)`). The `payments` table, `orders.status` (`OPEN`/`PAID`/
`CANCELLED`), `orders.discount_amount`/`discount_reason`/`closed_at`, and `tables.status`
(`EMPTY`/`OCCUPIED`) all already exist in the schema. There is **no** cashier surface today: no way
to list open tables, no way to discount, and no way to take payment or close a session — an order
stays `OPEN` forever and its table stays `OCCUPIED`.

## Tenancy

`orders` has its own `restaurant_id` column (FK → `restaurants`), so tenant scope is **direct**
(like US-017 tables): every operation scopes by `and(eq(orders.id, :id), eq(orders.restaurantId,
:tenant))`, and the list filters by `orders.restaurantId`. The restaurant always comes from
`auth.restaurantId` — never the request body or params. A missing or cross-tenant order id matches
no rows and surfaces as `404 ORDER_NOT_FOUND`, identical to a truly missing id (cross-tenant
existence is never revealed — same non-disclosure pattern as US-010/US-014…US-017).

## Target Behavior

All routes mounted under `/api/cashier`, guarded by `authGuard` + `.guard({ auth: ['CASHIER',
'ADMIN'] })`.

| Method | Path | Story | Behavior |
| --- | --- | --- | --- |
| GET | `/cashier/tables` | 5.1 | List the restaurant's **open** orders (one per occupied table) with running totals, oldest session first. |
| GET | `/cashier/orders/:id` | 5.2 | Full bill detail for one order (items, unit price, qty, line total, options, discount, total). Not in tenant → `404 ORDER_NOT_FOUND`. |
| PATCH | `/cashier/orders/:id/discount` | 5.3 | `{ type, value, reason? }` → set discount, recompute total. Order not `OPEN` → `409 ORDER_NOT_OPEN`. Not in tenant → `404 ORDER_NOT_FOUND`. |
| POST | `/cashier/orders/:id/payment` | 5.4 | `{ method }` → finalize. Records payment, order → `PAID`, table → `EMPTY`. Order not `OPEN` → `409 ORDER_NOT_OPEN`. Not in tenant → `404 ORDER_NOT_FOUND`. |

### Field rules

- **Discount body** `{ type: 'PERCENT' | 'FIXED', value: integer ≥ 0, reason?: string }`.
  - `PERCENT`: `value` in `0..100`; `discountAmount = round(subtotal × value / 100)`.
  - `FIXED`: `value` is a VND amount (`≥ 0`); `discountAmount = value`.
  - Out-of-range `value` (e.g. `PERCENT > 100`, or negative) → `422 INVALID_DISCOUNT`.
  - `total` is always re-floored at `0` (`GREATEST(subtotal − discount, 0)`), so an over-large
    `FIXED` discount yields `total = 0`, never negative.
  - `reason` optional free text, persisted to `orders.discount_reason`.
- **Payment body** `{ method: 'CASH' | 'TRANSFER' | 'CARD' }`. The **amount is never client-supplied** —
  it is `orders.total` captured atomically at close-out (see below). `cashierId = auth.userId`.
- Bad `type`/`method` enum or non-integer `value` → `400 VALIDATION_ERROR` (Elysia body schema).
- `:id` is `format: 'uuid'`.

## Design Notes

### Open-tables list (US-5.1) — `list-open-tables.ts`

`listOpenTables(db, restaurantId)`: one explicit-column read joining `orders` × `tables` on
`orders.status = 'OPEN' AND orders.restaurantId = :tenant`, ordered by `orders.opened_at`. Returns
`OpenTableView[] = { orderId, tableId, tableName, subtotal, discountAmount, total, openedAt,
itemCount }`. `itemCount` is a correlated count of non-`CANCELLED` items (matches the billed
lines). No N+1, no `SELECT *`. **The "bill requested" badge (US-5.1 AC) is deferred** — it needs a
`service_requests` `REQUEST_BILL` writer (US-3.4, not yet built); see Non-Goals.

### Bill detail (US-5.2) — `get-bill.ts`

`getBill(db, restaurantId, orderId)`: tenant-scoped existence guard first (read `orders.restaurantId`;
missing/cross-tenant → `404 ORDER_NOT_FOUND`), then reuse the existing `loadOrder(db, orderId)`
(US-007 read model) to return the order header + items (each with `unitPrice`, `quantity`, line
total derivable as `unitPrice × quantity`, option snapshots) + `discountAmount` + `total`. The
tenant guard lives in the use-case; `loadOrder` is not modified.

### Discount (US-5.3) — `apply-discount.ts`

`applyDiscount(db, restaurantId, orderId, { type, value, reason })`:

1. Validate `value` range for `type` (else `422 INVALID_DISCOUNT`) — pure, unit-testable.
2. Resolve `discountAmount`: `FIXED` → `value`; `PERCENT` → computed from the order's current
   `subtotal`. We read `subtotal` under the tenant+open guard, compute `round(subtotal × value /
   100)` in app code, then write.
3. Conditional UPDATE (mirrors the kitchen gate): `SET discount_amount, discount_reason,
   total = GREATEST(subtotal − :discountAmount, 0) WHERE id = :id AND restaurant_id = :tenant AND
   status = 'OPEN' RETURNING …`. `0` rows → disambiguate with one tenant-scoped existence read:
   missing/cross-tenant → `404 ORDER_NOT_FOUND`; exists but not `OPEN` → `409 ORDER_NOT_OPEN`.

Returns the updated bill (via `loadOrder`).

### Finalize payment (US-5.4) — `checkout-order.ts` — money-critical

`checkoutOrder(db, restaurantId, orderId, { method }, cashierId)`. Three autocommit statements,
gated so the close-out is atomic-at-the-gate (consistent with the codebase's autocommit +
conditional-update pattern; **no multi-statement transaction** — see Neon pooler note in memory):

1. **Gate** — claim the order atomically:
   `UPDATE orders SET status = 'PAID', closed_at = now() WHERE id = :id AND restaurant_id =
   :tenant AND status = 'OPEN' RETURNING { tableId, total }`.
   Exactly **one** concurrent request can flip `OPEN → PAID`; it receives the row. `0` rows →
   disambiguate (existence read): missing/cross-tenant → `404 ORDER_NOT_FOUND`; exists but already
   `PAID`/`CANCELLED` → `409 ORDER_NOT_OPEN`. **This gate is the double-charge guard.**
2. **Record payment** — `INSERT payments { orderId, method, amount: total (from the gate's
   RETURNING — server-authoritative), cashierId, paidAt: now() }`.
3. **Free the table** — `UPDATE tables SET status = 'EMPTY' WHERE id = :tableId` (idempotent;
   re-converges the OCCUPIED-iff-OPEN invariant, symmetric to `ensureOpenOrder`'s OCCUPIED mark).

Returns `{ payment: { id, method, amount, paidAt }, order: loadOrder(...) }` (order now `PAID`).

**No item-status gate:** checkout is allowed regardless of item state (`PENDING`/`COOKING`/
`SERVED`) — matches real restaurant flow. `subtotal`/`total` already exclude `CANCELLED` items.
A fully-discounted bill (`total = 0`) is still payable: the payment row (amount `0`) records the
session closure.

### Money-safety invariants & accepted trade-off

- ✅ **No double-charge** — the `OPEN → PAID` gate is atomic; a racing second checkout flips `0`
  rows and gets `409 ORDER_NOT_OPEN`. At most one `payments` row per order.
- ✅ **Server-authoritative amount** — `payments.amount = orders.total` captured by the gate; the
  client cannot dictate the charged sum.
- ⚠️ **Rare crash window** — if the process dies *between* the gate (step 1) and the payment insert
  (step 2), the order is `PAID` with **no** `payments` row (a lost audit record, **not** a double
  charge or a charge of the wrong amount). This is the accepted cost of staying on the codebase's
  autocommit/gate pattern rather than introducing a multi-statement transaction. The invariant and
  this window are recorded in `validation.md`. *(Alternative considered: wrap steps 1–2 in a real
  transaction — Neon's transaction-mode pooler supports it — but it departs from the established
  pattern; gate-first is chosen.)*

## Errors

| Code | Status | Notes |
| --- | --- | --- |
| `ORDER_NOT_FOUND` | **404 (new)** | Order missing or in another restaurant (bill, discount, checkout). |
| `ORDER_NOT_OPEN` | **409 (new)** | Order is not `OPEN`; discount/checkout refused (already `PAID`/`CANCELLED`). |
| `INVALID_DISCOUNT` | **422 (new)** | Discount `value` out of range for its `type`. |

## Files

- Create: `src/application/cashier/open-table-view.ts` (`OpenTableView` + mapper) *(optional; may inline)*
- Create: `src/application/cashier/list-open-tables.ts`
- Create: `src/application/cashier/get-bill.ts`
- Create: `src/application/cashier/discount.ts` (pure `resolveDiscountAmount` math)
- Create: `src/application/cashier/apply-discount.ts`
- Create: `src/application/cashier/checkout-order.ts`
- Create: `src/presentation/http/routes/cashier.ts` (`new Elysia({ prefix: '/cashier' })`)
- Modify: `src/presentation/http/app.ts` (mount `cashierRoutes`)
- Modify: `src/shared/errors/error-catalog.ts` (add `ORDER_NOT_FOUND`, `ORDER_NOT_OPEN`, `INVALID_DISCOUNT`)
- Test: `test/cashier/discount.test.ts` (unit — discount math)
- Test: `test/cashier/cashier-use-cases.test.ts` (DB-backed, self-skipping)
- Test: `test/cashier/cashier-routes.integration.test.ts` (two-tenant HTTP)

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | `resolveDiscountAmount`: `PERCENT` rounds `subtotal × value/100`; `FIXED` returns `value`; out-of-range → `INVALID_DISCOUNT`; total clamps at `0`. |
| Integration | List shows only this tenant's open orders with correct totals; bill detail cross-tenant → `404`; discount on `OPEN` updates `total` (PERCENT + FIXED), on `PAID` → `409 ORDER_NOT_OPEN`, value `> 100` → `422`; **checkout happy → order `PAID`, `payments.amount = total`, table `EMPTY`, `closed_at` set**; **double checkout → exactly one payment, second → `409 ORDER_NOT_OPEN`**; cross-tenant checkout → `404`; RBAC 401/403 (no token / wrong role). |
| E2E | Deferred — covered indirectly: order opened via US-007 customer flow → appears in `/cashier/tables` → discount → payment closes it; the freed table re-opens a fresh order on the next QR scan (US-005). |
| Platform | n/a |
| Release | n/a |

## Harness Delta

None. Reuses `authGuard`, `AppError`/error-catalog, `pgErrorCode`, the Drizzle client, the
conditional-update gate pattern (kitchen `advance-item-status`), `loadOrder`/`computeOrderTotals`
(orders), and the `{ data }` / `{ error }` envelopes.

## Non-Goals (deferred)

- **"Bill requested" badge** (US-5.1 AC) — needs a `service_requests` `REQUEST_BILL` writer
  (US-3.4 "call staff / request bill", deferred). Added when US-3.4 lands; the cashier read gains
  a badge field then.
- **Surcharge / additional fee** — only discounts in this slice (per brainstorming). A surcharge
  would need a schema decision (negative `discount_amount` vs a new column); out of scope.
- **Cash tendered / change calculation** — `payments.amount = total`; tendered amount and change
  are a frontend concern (YAGNI on the backend).
- **Invoice render (PNG/PDF print)** — backend returns the bill data; rendering is a frontend/later
  story.
- **Split bills / partial payment / refunds / void-after-paid** — single full payment closes the
  order; reversing a `PAID` order is out of scope.
- **Cashier realtime (SSE)** — cashier polls `/cashier/tables`; no order-level `NOTIFY` is added in
  this slice (US-9.1 staff order-level stream remains future work).
