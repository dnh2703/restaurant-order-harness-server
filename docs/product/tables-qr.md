# Tables & QR Sessions

Covers EPIC 1 (QR access & table session) and US-6.4 (table administration).

## Table Administration (US-6.4, Admin)

- `ADMIN` can CRUD tables: `name`/number, `capacity`, and the QR `qr_token`.
- Each table has a unique `qr_token`.
- **Regenerate token** (US-1.3): issuing a new `qr_token` immediately invalidates the
  old QR. Any in-flight session keyed on the old token can no longer resolve.
- **Export QR** (US-1.3): produce a printable QR (PNG/PDF) encoding the table's QR URL
  (`/api/qr/:qrToken` entry).

## QR Resolution (US-1.1, Customer)

1. Customer scans QR → opens the customer app with `qrToken`.
2. Backend resolves `qrToken` → `table`. Unknown/regenerated token →
   `404 INVALID_TABLE` and the FE shows an "Invalid table" screen.
3. Resolve or create the table's single `OPEN` order (table session):
   - If an `OPEN` order exists for the table, reuse it.
   - Otherwise create one (`status = OPEN`, `opened_at = now`) and set the table
     `OCCUPIED`.
   - Concurrency: rely on the partial unique index
     `orders(table_id) WHERE status='OPEN'`; on conflict, re-read the existing open
     order rather than failing.

## Session Header (US-1.2)

The customer screen header shows: restaurant `name`, table `name`/number, and session
status (open since `opened_at`). This confirms the guest is at the right table.

## Endpoints

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| GET | `/api/qr/:qrToken` | none | resolve table + open/get OPEN order; returns session header data |
| GET | `/api/tables` | ADMIN | list tables + status |
| POST | `/api/tables` | ADMIN | create table (auto QR token) |
| PATCH | `/api/tables/:id` | ADMIN | update name/capacity |
| POST | `/api/tables/:id/regenerate-qr` | ADMIN | new token, invalidate old |
| GET | `/api/tables/:id/qr.png` | ADMIN | export QR image |
| DELETE | `/api/tables/:id` | ADMIN | remove table (blocked if it has an OPEN order) |

## Rules

- A table can have at most one `OPEN` order at a time (see `data-model.md`).
- Deleting or regenerating must not silently drop an active bill; deleting a table
  with an `OPEN` order returns `409 TABLE_BUSY`.

## Validation Shape

| Layer | Proof |
| --- | --- |
| Unit | token generation/uniqueness, resolve-or-create order logic |
| Integration | scan unknown token → 404; scan valid → reuse existing OPEN order; regenerate invalidates old |
| E2E | scan QR → land on correct table header with open session |
