# US-019 Reports — Design Spec

> SPEC EPIC 7 (US-7.1 revenue by date range, US-7.2 top-selling dishes). Epic E10.
> Risk: normal (read-only aggregations, no money mutation, no schema change).

## Problem

E08 now writes a durable `payments` row on every checkout, and `orders`/`order_items`
carry the billed history. But an `ADMIN` has no way to see revenue or what sells. E10
adds the reporting read surface over that existing data — no new columns, no migration.

## Target Behavior

An `ADMIN`, scoped to their own restaurant, gets a read-only reporting surface under
`/api/reports` (guard `['ADMIN']`):

- **Revenue by day** (`GET /reports/revenue?from=&to=`) — daily sum of `payments.amount`
  over an inclusive local-date range, plus a range summary.
- **Top-selling dishes** (`GET /reports/top-dishes?from=&to=&limit=`) — dishes ranked by
  quantity sold from the `order_items` of paid orders in the range.

Tenancy is indirect through `orders.restaurant_id` (the `payments` and `order_items`
tables carry no `restaurant_id`); every query joins `orders` and filters on
`auth.restaurantId`. No cross-tenant row is ever counted.

## Endpoints

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| GET | `/api/reports/revenue?from=&to=` | ADMIN | daily revenue series + summary |
| GET | `/api/reports/top-dishes?from=&to=&limit=` | ADMIN | ranked dishes |

### Query parameters

- `from`, `to` — **required**, local calendar dates `YYYY-MM-DD`, **inclusive** of both
  endpoints. Shape (`^\d{4}-\d{2}-\d{2}$`) is enforced at the Elysia query layer.
- `limit` (top-dishes only) — optional integer, **default 10, max 50, min 1**.

### Revenue response

```json
{
  "data": {
    "days": [
      { "day": "2026-06-27", "revenue": 480000, "orderCount": 3 },
      { "day": "2026-06-29", "revenue": 125000, "orderCount": 1 }
    ],
    "summary": { "from": "2026-06-27", "to": "2026-06-29", "totalRevenue": 605000, "totalOrders": 4 }
  }
}
```

- `days` is a **sparse series** — only days with at least one payment appear. Zero-filling
  the full range is a presentation concern left to the frontend (YAGNI). `summary` always
  reflects the full requested range.
- `revenue` sums `payments.amount` (server-authoritative); `orderCount` is the count of
  paid orders that day. `totalRevenue`/`totalOrders` are the range rollups.

### Top-dishes response

```json
{
  "data": {
    "dishes": [
      { "menuItemId": "…", "name": "Phở bò", "quantitySold": 42, "revenue": 2940000 },
      { "menuItemId": "…", "name": "Cà phê sữa", "quantitySold": 31, "revenue": 775000 }
    ]
  }
}
```

- Grouped by `menu_item_id` (stable identity across renames); `name` is the **latest**
  `name_snapshot` for that item in range.
- Ranked `quantitySold DESC`, tiebreak `revenue DESC`, then `LIMIT n`.
- `quantitySold` and `revenue` count only **non-`CANCELLED`** lines of **paid** orders.
- `revenue = Σ(quantity × unit_price)` — **excludes `order_item_options.price_delta`**.
  Quantity is the authoritative ranking metric; revenue is an indicative figure, kept to a
  single table to avoid a second aggregation. Documented limitation.

## Data sources & money definition

- **Revenue is `payments.amount`**, never `orders.total`. A `payments` row exists only for
  a `PAID` order (minted at the checkout gate in US-018), so joining `payments` inherently
  excludes open tabs — open tables never inflate revenue.
- **Date attribution** uses `payments.paid_at` for revenue and for the top-dishes range
  filter (a dish is attributed to the day its order was paid, not when it was cooked).
- `order_items` for top-dishes are reached `orders → payments` (paid only) and filtered
  `status <> 'CANCELLED'`.

## Timezone

A single app-wide constant `APP_TZ = 'Asia/Ho_Chi_Minh'` (VND, Vietnam context; one tenant
timezone in practice). A timestamp's report day is:

```sql
(payments.paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
```

so an 11pm-local payment is counted on its local day, not the UTC day. The `from`/`to`
params are compared against that local date with `BETWEEN from AND to` (inclusive).
Documented assumption: a single restaurant timezone. Revisiting it (a per-restaurant
`restaurants.timezone` column) is a future migration, out of scope here.

## Validation & errors

One new error code:

| Code | Status | When |
| --- | --- | --- |
| `INVALID_DATE_RANGE` | 422 | `from`/`to` malformed, `from > to`, or span `> 366` days |

- Shape (`YYYY-MM-DD`) is rejected at the Elysia query schema (→ framework
  `VALIDATION_ERROR` 400 for a non-date string / missing param).
- Semantic checks live in a **pure** `parseReportRange({ from, to })`: it parses both dates,
  asserts `from <= to`, and bounds the span at 366 days (caps result size); any failure
  throws `INVALID_DATE_RANGE`. Unit-tested in isolation.

## Architecture

Clean Architecture, matching the cashier slice (US-018):

- `src/application/reports/date-range.ts` — `APP_TZ` constant; pure `parseReportRange`;
  the `ReportRange` type. No DB.
- `src/application/reports/revenue-by-day.ts` — `getRevenueByDay(db, restaurantId, range)`:
  one grouped aggregation (`payments` ⋈ `orders`) returning the sparse day rows; the
  summary is computed from those rows in application code (no second query).
- `src/application/reports/top-dishes.ts` — `getTopDishes(db, restaurantId, range, limit)`:
  one grouped aggregation (`order_items` ⋈ `orders` ⋈ `payments`).
- `src/presentation/http/routes/reports.ts` — Elysia module, prefix `/reports`,
  `.use(authGuard).guard({ auth: ['ADMIN'] })`, two GET routes; query schemas with the
  date pattern and `limit` bounds. Catches the pure-parser throw into the error pipeline.
- `src/presentation/http/app.ts` — mount `reportsRoutes` under the global `/api` prefix.
- `src/shared/errors/error-catalog.ts` — add `INVALID_DATE_RANGE`.

Every use-case takes `Database` as its first arg; `restaurantId` always comes from
`auth.restaurantId`, never the query string. Reads are explicit-column selects with
aggregates — no `SELECT *`, no N+1 (one query per endpoint), per the Neon egress guidance.

## Money & correctness invariants

- Revenue counts a payment **once**, on its local paid day; tenant-scoped via the
  `orders` join. No double count, no cross-tenant leak.
- Open / cancelled orders contribute **zero** revenue (no `payments` row).
- Top-dishes excludes `CANCELLED` lines and unpaid orders.
- Reports never mutate; they are safe to call concurrently and repeatedly.

## Non-Goals

- **CSV export** (`/top-dishes.csv`, US-7.2 optional) — JSON only; a frontend can derive CSV.
- **Zero-filled continuous series** — sparse rows + frontend fill.
- **Per-restaurant timezone** — single `APP_TZ`; no `restaurants.timezone` column / migration.
- **Indexes** on `orders.restaurant_id` / `payments.paid_at` — would help at scale but need
  a migration; deferred (recorded as a follow-up). Acceptable at current data volume.
- **Option-delta revenue attribution** in top-dishes — `quantity × unit_price` only.
- **Charts / pagination / custom groupings (weekly/monthly)** — daily granularity only.

## Validation Shape

| Layer | Proof |
| --- | --- |
| Unit | `parseReportRange`: valid range passes; `from > to` → `INVALID_DATE_RANGE`; span > 366 → `INVALID_DATE_RANGE`; malformed date → `INVALID_DATE_RANGE`. |
| Integration | Two tenants. Revenue: seeded PAID orders across two local days produce correct per-day sums + summary; an OPEN order and a cross-tenant payment contribute nothing; a payment at the local-day boundary (23:30 +07) lands on the right day. Top-dishes: ranking by quantity with a revenue tiebreak; `limit` honored; CANCELLED line excluded; cross-tenant isolation. RBAC: non-ADMIN (CASHIER) token → 403; no token → 401. Bad range → 422 `INVALID_DATE_RANGE`. |
| E2E | Deferred — admin picks a range and sees revenue + top dishes (covered indirectly by the integration suite). |
| Platform | n/a (backend only). |
| Performance | n/a (two grouped single-pass aggregations; result size bounded by the 366-day span and `limit ≤ 50`). |
