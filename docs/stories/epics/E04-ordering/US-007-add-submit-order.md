# US-007 Add Items + Submit Order

## Status

implemented

## Lane

normal

## Product Contract

Let a customer submit cart items to their table's `OPEN` order. Each item is created
`PENDING` with snapshotted name, unit price (incl. options), quantity, and note; the
server recomputes order totals. Re-submitting appends to the same open order.
Implements SPEC US-3.1 and US-3.2.

## Relevant Product Docs

- `docs/product/ordering.md`
- `docs/product/data-model.md`

## Acceptance Criteria

- `POST /api/qr/:qrToken/order-items` creates `order_items` (status `PENDING`) +
  `order_item_options` snapshots on the existing OPEN order.
- `unit_price` is computed server-side as `menu_items.price + Σ(option.price_delta)`;
  client-sent prices are ignored.
- `name_snapshot` and option snapshots are stored so later menu edits don't alter the
  placed order.
- Order `subtotal`/`total` recomputed from non-cancelled items after submit.
- Second submit in the same session appends (does not replace) and does not open a
  second order.
- Reject unavailable item (`409 ITEM_UNAVAILABLE`), `quantity < 1`, or missing required
  option group (`422`).

## Design Notes

- Commands: `AddOrderItems` (append + recompute totals).
- Queries: load OPEN order; load menu item + options for pricing.
- API: `POST /api/qr/:qrToken/order-items`; `GET /api/qr/:qrToken/order`.
- Tables: `orders`, `order_items`, `order_item_options`, `menu_items`, `options`.
- Domain rules: server-authoritative pricing; snapshots; append semantics; total
  recompute.
- UI surfaces: customer cart → confirmation.

## Validation

`scripts/bin/harness-cli story update --id US-007 --unit 1 --integration 1 --e2e 0 --platform 0`

| Layer | Expected proof |
| --- | --- |
| Unit | unit_price + subtotal/total math; required-option enforcement |
| Integration | submit appends + recomputes; second submit appends; unavailable item rejected |
| E2E | add to cart → submit → items PENDING on order |
| Platform | n/a |
| Release | n/a |

## Harness Delta

None expected; depends on US-002 schema and US-005 session. Service requests (US-3.4)
and live status (US-3.3) tracked separately (US-008 / candidate).

## Evidence

Verified on a live Neon branch, 2026-06-27.

- **API:** `POST /api/qr/:qrToken/order-items` and `GET /api/qr/:qrToken/order`
  (`src/presentation/http/routes/qr.ts`) → `addOrderItems` / `getOrderForQrToken`
  (`src/application/orders/`). POST returns `201` with the updated order
  (`{ data: { id, status, subtotal, discountAmount, total, openedAt, items: [{ id,
  menuItemId, nameSnapshot, unitPrice, quantity, note, status, createdAt, options: [{
  optionName, priceDelta }] }] } }`); GET returns the same shape.
- **Session reuse:** both routes resolve the table and reuse-or-open the single OPEN order
  via `ensureOpenOrder` (mirrors US-005: `23505` re-read on a racing insert, idempotent
  OCCUPIED mark, autocommit single statements). Re-submitting appends to the same OPEN
  order — verified there is exactly one OPEN order per table after two submits.
- **Server-authoritative pricing:** `unit_price = menu_items.price + Σ(option.price_delta)`
  computed in `priceOrderItem`; the client-sent price (if any) is ignored. `name_snapshot`
  and `order_item_options` snapshots are stored so later menu edits never alter a placed
  order. Items are stored `PENDING`.
- **Totals:** order `subtotal`/`total` recomputed after each submit by a single atomic SQL
  UPDATE (`subtotal = Σ unit_price×quantity` over non-cancelled items,
  `total = max(subtotal − discount, 0)`), so concurrent submits converge. Mirrors the pure
  `computeOrderTotals`.
- **Scoping:** menu items are loaded joined through `categories.restaurant_id`, so an item
  from another restaurant is treated as not found (no cross-restaurant ordering).
- **Rejections:** whole cart is validated/priced before any write (atomic rejection, nothing
  inserted on failure): unavailable item → `409 ITEM_UNAVAILABLE`; `quantity < 1` →
  `422 INVALID_QUANTITY`; missing required option group → `422 MISSING_REQUIRED_OPTION`;
  invalid/foreign option → `422 INVALID_OPTION`; unknown/cross-restaurant item →
  `404 MENU_ITEM_NOT_FOUND`; unknown token → `404 INVALID_TABLE`.
- **Unit** (`test/order-pricing.test.ts`): `priceOrderItem` proves unit_price math, option
  snapshots, and every rejection; `computeOrderTotals` proves the subtotal/total formula
  (non-cancelled, discount, floor-at-zero) — all DB-free.
- **Integration** (`test/order.test.ts`, live Neon): submit prices server-side + stores
  PENDING with snapshots + recomputes totals; a second submit appends without opening a
  second order; sold-out → 409; bad quantity → 422; missing required option → 422;
  cross-restaurant item → 404. Self-skips when the DB is unmigrated/unreachable.
- **Quality gates:** `typecheck`, `oxlint`, `prettier` clean. `order-pricing` + `order`
  17 pass.
