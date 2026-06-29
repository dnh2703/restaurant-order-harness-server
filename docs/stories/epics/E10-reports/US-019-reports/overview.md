# Overview — US-019 Reports

## Current Behavior

E08 now writes a durable `payments` row on every checkout, and `orders`/`order_items` carry the
billed history. But an `ADMIN` has no way to see revenue or what sells — the reporting columns
exist, with no surface over them.

## Target Behavior

An `ADMIN`, scoped to their own restaurant, gets a read-only reporting surface under `/api/reports`
(guard `['ADMIN']`):

- **Revenue by day** (`GET /reports/revenue?from=&to=`) — daily sum of `payments.amount` over an
  inclusive local-date range, plus a range summary. Sparse series (only days with a payment).
- **Top-selling dishes** (`GET /reports/top-dishes?from=&to=&limit=`) — dishes ranked by quantity
  sold from the `order_items` of paid orders in range, grouped by `menu_item_id`, latest name.

Tenancy is indirect through `orders.restaurant_id` from `auth.restaurantId`; `payments`/`order_items`
carry no `restaurant_id`, so every query joins `orders`. A single app-wide timezone
`APP_TZ = 'Asia/Ho_Chi_Minh'` defines day boundaries. Out-of-range dates → `422 INVALID_DATE_RANGE`.

## Correctness invariants

- **Revenue is `payments.amount`**, never `orders.total`; a payment exists only for a PAID order,
  so open tabs never inflate revenue.
- **Tenant-scoped** via the `orders` join; no cross-tenant row is ever counted.
- **Local-day attribution** — an 11pm-local payment lands on its local day, not the UTC day.
- **Integer-safe money** — sums read back via `Number()` (no `::int` cast), avoiding int4 overflow.

## Affected Users

- `ADMIN` — gains revenue and top-dish reporting.
- `CASHIER`/`KITCHEN` — no access (ADMIN-only); `403` on attempt.

## Affected Product Docs

- `docs/product/reports.md` (EPIC 7)
- `docs/product/api-conventions.md` (new `INVALID_DATE_RANGE` code, `/reports` routes)

## Non-Goals

- **CSV export** (`/top-dishes.csv`, US-7.2 optional) — JSON only.
- **Zero-filled continuous series** — sparse rows; frontend fills gaps.
- **Per-restaurant timezone** — single `APP_TZ`; no `restaurants.timezone` column / migration.
- **Option-delta revenue attribution** in top-dishes — `quantity × unit_price` only.
- **Indexes** on `orders.restaurant_id` / `payments.paid_at` — would need a migration; deferred.
- **Charts / pagination / weekly-monthly groupings** — daily granularity only.
