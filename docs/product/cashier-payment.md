# Cashier & Payment

Covers EPIC 5. Staff role `CASHIER` (or `ADMIN`). **Touches money and closes
sessions** — payment + checkout are high-risk; behavior changes need a decision record.

## Open Tables (US-5.1)

- Grid/list of tables with an `OPEN` order, each showing the running `total`.
- A "bill requested" badge appears when the table has an open `REQUEST_BILL`
  `service_request`. "Call staff" requests are likewise surfaced.

## Bill Detail (US-5.2)

- For a table's `OPEN` order: list items (`name_snapshot`, `unit_price`, `quantity`,
  line total), plus `discount_amount`, and `total`.

## Discounts / Surcharges (US-5.3)

- Apply a discount by **percent** or **fixed amount**; record `discount_reason`.
- Server recomputes `total = subtotal − discount_amount` (clamped ≥ 0). Surcharge is a
  negative discount or a separate line — modeled as `discount_amount` sign per
  decision; default MVP: discount only, `discount_amount ≥ 0`.

## Checkout (US-5.4)

- Choose method `CASH` / `TRANSFER` / `CARD`.
- On checkout, atomically:
  1. Create a `payments` row (`amount = order.total`, `cashier_id`, `paid_at = now`).
  2. Set order `status = PAID`, `closed_at = now`.
  3. Set the table `status = EMPTY` (session closed).
- Print/preview the invoice.
- Idempotency: checking out an already-`PAID` order returns `409 ORDER_NOT_OPEN`.

## Service Requests

- Cashier sees `CALL_STAFF` / `REQUEST_BILL` requests in realtime and marks them
  `DONE`.

## Endpoints

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| GET | `/api/cashier/tables` | CASHIER | open tables + totals + request badges |
| GET | `/api/cashier/orders/:orderId` | CASHIER | bill detail |
| PATCH | `/api/cashier/orders/:orderId/discount` | CASHIER | apply discount/surcharge |
| POST | `/api/cashier/orders/:orderId/checkout` | CASHIER | record payment, close session |
| PATCH | `/api/cashier/service-requests/:id` | CASHIER | mark DONE |

## Rules

- Checkout requires order `status = OPEN`; recompute totals server-side before
  recording payment.
- The whole checkout is one DB transaction; a failure rolls back payment, order, and
  table status together.

## Validation Shape

| Layer | Proof |
| --- | --- |
| Unit | discount math (percent + fixed), total clamp, transition guards |
| Integration | checkout writes payment + PAID + EMPTY atomically; double checkout rejected |
| E2E | cashier opens bill, applies discount, checks out cash, table frees |
