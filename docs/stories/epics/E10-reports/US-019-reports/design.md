# Design — US-019 Reports

Full design rationale: `docs/superpowers/specs/2026-06-29-us-019-reports-design.md`.
Implementation plan: `docs/superpowers/plans/2026-06-29-us-019-reports.md`.

## Domain Model

Reads only — no new tables, no migration:

- `payments` (`order_id`, `amount`, `paid_at`) — the server-authoritative money record; a row
  exists only for a `PAID` order.
- `orders` (`restaurant_id`, `status`) — the tenant scope (via join) and the PAID gate.
- `order_items` (`menu_item_id`, `name_snapshot`, `unit_price`, `quantity`, `status`) — the
  top-dishes source.

Business rules: revenue sums `payments.amount` (never `orders.total`); a row's report day is
`(paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`; top-dishes ranks non-`CANCELLED` lines of PAID
orders by quantity (tiebreak revenue), grouped by `menu_item_id` with the latest `name_snapshot`.

## Application Flow

`src/application/reports/`:

- `date-range.ts` — `APP_TZ`, `MAX_RANGE_DAYS`, `ReportRange`, and pure `parseReportRange` (throws
  `INVALID_DATE_RANGE` on malformed date / `from > to` / span > 366 days).
- `revenue-by-day.ts` — `getRevenueByDay`: one grouped `payments ⋈ orders` aggregation; sparse day
  series + a range summary folded in app code.
- `top-dishes.ts` — `getTopDishes`: one grouped `order_items ⋈ orders ⋈ payments` aggregation;
  ranked, `LIMIT n`.

`src/presentation/http/routes/reports.ts` — Elysia module, prefix `/reports`, guard `['ADMIN']`,
two GET routes; date pattern enforced at the query layer, semantics in `parseReportRange`. Mounted
in `app.ts`.

## API

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| GET | `/api/reports/revenue?from=&to=` | ADMIN | daily revenue series + summary |
| GET | `/api/reports/top-dishes?from=&to=&limit=` | ADMIN | dishes ranked by quantity sold |
