# Ordering

Covers EPIC 3 (cart & ordering, customer). Depends on an OPEN order session from
[`tables-qr.md`](tables-qr.md).

## Cart (US-3.1)

- The cart is client-side until submitted. Each line holds: `menu_item`, chosen
  options, `quantity`, and a `note`.
- Increase/decrease quantity (min 1), remove line.
- Running subtotal updates live: `Σ(line unit_price × quantity)` where
  `unit_price = menu_items.price + Σ(option.price_delta)`.

## Submit Order (US-3.2)

- Submitting creates `order_items` against the table's existing `OPEN` order with
  status `PENDING`, plus `order_item_options` snapshots.
- Each `order_item` snapshots `name_snapshot` and `unit_price` at order time so later
  menu edits never change a placed order.
- Server recomputes the order `subtotal`/`total` from items (never trusts a
  client-sent total).
- After submit: cart clears, a confirmation is shown, and a realtime event fires to
  kitchen + cashier.
- **Re-ordering**: guests may submit multiple times in one session; new items append
  to the same `OPEN` order.

## Track Status (US-3.3)

- Customer sees their ordered items with live status `PENDING → COOKING → SERVED`
  (realtime; see [`realtime.md`](realtime.md), fallback poll 2–3s).

## Call Staff / Request Bill (US-3.4)

- "Call staff" → create `service_request` `type = CALL_STAFF`.
- "Request bill" → create `service_request` `type = REQUEST_BILL`.
- Both notify the cashier in realtime; cashier marks them `DONE`
  (see [`cashier-payment.md`](cashier-payment.md)).

## Endpoints

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| POST | `/api/qr/:qrToken/order-items` | none | append items to the OPEN order |
| GET | `/api/qr/:qrToken/order` | none | current order with items + statuses |
| POST | `/api/qr/:qrToken/service-requests` | none | call staff / request bill |

## Rules

- Reject submit if any `menu_item` is `is_available = false` → `409 ITEM_UNAVAILABLE`.
- Reject `quantity < 1` and missing required option groups → `422`.
- Server is authoritative for `unit_price`; recompute from menu + options, never trust
  client price.

## Validation Shape

| Layer | Proof |
| --- | --- |
| Unit | unit_price computation, subtotal/total recompute, required-option enforcement |
| Integration | submit appends to OPEN order; second submit appends not replaces; unavailable item rejected |
| E2E | add to cart → submit → items appear PENDING; request bill creates service request |
