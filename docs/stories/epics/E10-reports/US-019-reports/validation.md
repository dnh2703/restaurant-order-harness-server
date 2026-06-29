# Validation — US-019 Reports

## Proof Strategy

A normal-risk, read-only feature: the proof must show the aggregations are correct and the
tenant/PAID/timezone scoping holds. Pure date math is unit-tested; the DB-backed aggregations are
proven through HTTP integration tests against a live migrated Neon branch (the suite self-skips when
the DB is unreachable, so a green run only counts when executed against the real DB).

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | `parseReportRange`: valid range; single-day (`from === to`); `from > to` → `INVALID_DATE_RANGE`; malformed date → `INVALID_DATE_RANGE`; rolled-over `2026-02-30` → `INVALID_DATE_RANGE`; span > 366 → `INVALID_DATE_RANGE`. |
| Integration (revenue) | Per-day `payments.amount` sums + range summary; an OPEN order (no payment) and a cross-tenant payment contribute nothing; a late-night payment (18:30Z) lands on the correct **local** day (04-02); `from > to` → `422 INVALID_DATE_RANGE`; CASHIER token → `403`, no token → `401`. |
| Integration (top-dishes) | Quantity ranking with revenue tiebreak; `limit` honored; CANCELLED line excluded; default limit ≤ 10; cross-tenant dish absent; **rename-stability — two orders sharing one `menu_item_id` under two `name_snapshot`s roll up to one row under the latest name with combined quantity** (pins group-by-`menu_item_id`). |
| E2E | Deferred — covered indirectly: an admin picks a range and sees revenue + top dishes. |
| Platform | n/a (backend only). |
| Performance | n/a (two grouped single-pass aggregations; result bounded by the 366-day span and `limit ≤ 50`). |

## Fixtures

- Two restaurants A and B; users: admin-A (`ADMIN`), cashier-A (`CASHIER`), admin-B (`ADMIN`).
- `seedPaidOrder` seeds a PAID order with one priced item and a payment at a given `paidAt`; it
  reuses one `menu_items` row per distinct dish name (real orders of a dish share a `menu_item_id`),
  with an opt-in `menuItemId` override to simulate a rename.
- Teardown deletes payments → orders (cascades order_items) → tables → the created menu items →
  category → users → restaurants (FK-safe).

## Commands

```text
bun test test/reports/date-range.test.ts
bun test test/reports/reports-routes.integration.test.ts
bun run typecheck && bun run lint
```

## Acceptance Evidence

- Unit: `date-range.test.ts` 6/6.
- Integration: `reports-routes.integration.test.ts` 7/7 (4 revenue + 3 top-dishes), executed against
  a live migrated Neon branch (DB ran).
- `typecheck` clean; `lint` clean. No schema/migration change.
- Reviews: all three per-task gates Approved (Task 3 had a grouping deviation — implementer grouped
  by `name_snapshot`; controller-directed fix restored spec `groupBy(menu_item_id)` + corrected the
  fixture identity model). Final whole-branch review: blocker = rename-stability test gap, fixed; an
  Important raw-`'CANCELLED'` filter upgraded to type-safe `ne(...)`. Ready to merge.

### Deferred follow-ups (non-blocking)

- `COALESCE(SUM(...), 0)` in `revenue-by-day.ts` is redundant for a grouped aggregation — harmless.
- Late-night TZ test comment documents an un-seeded scenario before the seeded one — cosmetic.
- Indexes on `orders.restaurant_id` / `payments.paid_at` would help at scale (needs a migration).
