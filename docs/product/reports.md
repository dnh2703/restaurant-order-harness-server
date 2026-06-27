# Reports

Covers EPIC 7 (minimal). Staff role `ADMIN`.

## Revenue by Date Range (US-7.1)

- Sum `payments.amount` (or `orders.total` of `PAID` orders) grouped by day over a
  selected date range.
- Filter by date range; scoped to the admin's `restaurantId`.

## Top-Selling Dishes (US-7.2)

- Rank dishes by quantity sold (and/or revenue) from `order_items` of `PAID` orders,
  over a date range.
- Optional CSV export.

## Endpoints

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| GET | `/api/reports/revenue?from=&to=` | ADMIN | daily revenue series |
| GET | `/api/reports/top-dishes?from=&to=&limit=` | ADMIN | ranked dishes |
| GET | `/api/reports/top-dishes.csv?from=&to=` | ADMIN | CSV export (optional) |

## Rules

- Reports read only `PAID` orders so open tabs do not inflate revenue.
- Date filters are inclusive of local restaurant timezone day boundaries.
- Aggregations should use indexed columns; avoid `SELECT *` and over-fetching
  (see the Neon egress-optimizer guidance).

## Validation Shape

| Layer | Proof |
| --- | --- |
| Unit | aggregation math; date-range boundary handling; CSV formatting |
| Integration | seeded PAID orders produce correct revenue + top-dish ranking |
| E2E | admin picks a range and sees revenue + top dishes |
