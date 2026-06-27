# US-005 QR Resolve Table + Open Order Session

## Status

implemented

## Lane

normal

## Product Contract

When a customer hits `/api/qr/:qrToken`, resolve the table and reuse or create its
single `OPEN` order, then return session header data (restaurant name, table name,
session status). Invalid/regenerated tokens are rejected. Implements SPEC US-1.1 and
US-1.2.

## Relevant Product Docs

- `docs/product/tables-qr.md`
- `docs/product/data-model.md`

## Acceptance Criteria

- Valid `qrToken` → resolve `table`; reuse existing `OPEN` order or create one
  (`opened_at = now`) and set the table `OCCUPIED`.
- At most one `OPEN` order per table, enforced by the partial unique index; on
  conflict, re-read the existing open order instead of erroring.
- Unknown/regenerated token → `404 INVALID_TABLE`.
- Response includes restaurant name, table name/number, and session status.

## Design Notes

- Commands: `ResolveTableSession` (resolve-or-create OPEN order).
- Queries: lookup table by `qr_token`; lookup OPEN order by `table_id`.
- API: `GET /api/qr/:qrToken`.
- Tables: `tables`, `orders`.
- Domain rules: single OPEN order per table; table OCCUPIED iff OPEN order exists.
- UI surfaces: customer session header.

## Validation

`scripts/bin/harness-cli story update --id US-005 --unit 1 --integration 1 --e2e 0 --platform 0`

| Layer | Expected proof |
| --- | --- |
| Unit | resolve-or-create logic; invalid-token handling |
| Integration | second scan reuses same OPEN order; regenerated token → 404; concurrent scans don't create two orders |
| E2E | scan QR → correct header with open session |
| Platform | n/a |
| Release | n/a |

## Harness Delta

None expected; depends on US-002 schema.

## Evidence

Verified on a live Neon branch, 2026-06-27.

- **API:** `GET /api/qr/:qrToken` (`src/presentation/http/routes/qr.ts`) →
  `resolveTableSession` (`src/application/sessions/resolve-table-session.ts`). Returns
  `{ data: { restaurant.name, table.{id,name,status}, session.{orderId,status,openedAt} } }`.
- **Invalid token:** unknown/regenerated `qr_token` → `404 INVALID_TABLE` (new code in
  `src/shared/errors/error-catalog.ts`).
- **Resolve-or-create:** reuses an existing `OPEN` order; otherwise creates one and marks
  the table `OCCUPIED` (idempotent update). At most one `OPEN` order per table via the
  partial unique index; on a `23505` conflict the winner's order is re-read. Uses
  autocommit statements (no multi-statement transaction) to stay friendly to Neon's
  PgBouncer transaction-mode pooling.
- **Unit** (`test/resolve-table-session.test.ts`): unknown token throws
  `INVALID_TABLE`/404 without a DB.
- **Integration** (`test/qr-session.test.ts`, live Neon): unknown → 404; first scan
  creates order + sets `OCCUPIED`; second scan reuses the same `orderId`; three concurrent
  scans yield exactly one `OPEN` order. Self-skips when the DB is unmigrated/unreachable
  (`test/support/db.ts`).
- **Quality gates:** `typecheck`, `oxlint`, `prettier` clean. `qr-session` 4 pass solo;
  full suite 18 pass when the Neon network is stable.

## Harness Delta (actual)

- `src/infrastructure/database/client.ts`: pool gains `connectionTimeoutMillis: 10s` +
  `keepAlive` so a Neon cold/stuck connect fails fast instead of hanging on the ~75s OS
  TCP timeout.
- `test/support/db.ts`: shared warm-up / self-skip helper for the DB-backed suites.
- `test/orders-invariant.test.ts` (US-002): hardened with the same warm-up + generous
  timeouts — it was already flaky against a scaled-to-zero Neon compute.
