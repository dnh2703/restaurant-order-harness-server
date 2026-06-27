# US-005 QR Resolve Table + Open Order Session

## Status

planned

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

Add after implementation.
