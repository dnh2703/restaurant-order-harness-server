# US-007 Add Items + Submit Order

## Status

planned

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

Add after implementation.
