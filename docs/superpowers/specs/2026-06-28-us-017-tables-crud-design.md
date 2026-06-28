# US-017 Admin Tables CRUD + QR token — Design

**Epic:** E09 Admin CRUD · **Date:** 2026-06-28 · **Depends on:** US-005 QR → open order (merged), US-016 options CRUD (merged)

## Goal

Give an `ADMIN` full runtime management of their restaurant's tables — create, list, rename,
re-capacity, and delete — plus a per-table **QR token** that the customer flow resolves
(`GET /api/qr/:qrToken`, US-005). A dedicated `regenerate-qr` action mints a fresh token,
invalidating the old QR. Scoped to the admin's own restaurant via `auth.restaurantId`.

## Current Behavior

`tables` exists as a table and is read by the customer QR flow (`resolveTableSession`, US-005) and
the menu read (US-006), both by exact `qr_token` match. The only write surface today is the seed
script (`src/infrastructure/database/seed.ts`, friendly tokens like `qr-table-01`). There is no
admin CRUD: tables cannot be created, edited, deleted, or re-tokenized at runtime.

## Tenancy

`tables` has its own `restaurant_id` column (FK → `restaurants`), so tenant scope is **direct** —
simpler than US-015/US-016, which join through `categories`. Every operation scopes by
`and(eq(tables.id, :id), eq(tables.restaurantId, :tenant))`, and list filters by
`tables.restaurantId`. The restaurant always comes from `auth.restaurantId` — never from the
request body or params. A missing or cross-tenant id matches no rows and surfaces as
`404 TABLE_NOT_FOUND`, identical to a truly missing id (cross-tenant existence is never revealed —
same pattern as US-010/US-014/US-015/US-016).

## Target Behavior

All routes mounted under `/api/tables`, guarded by `authGuard` + `.guard({ auth: ['ADMIN'] })`.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/tables` | List the restaurant's tables, ordered by `name`. |
| POST | `/tables` | `{ name, capacity? }` → `201`. Server mints `qrToken`; `status` defaults `EMPTY`. |
| PATCH | `/tables/:id` | Partial patch `{ name?, capacity? }` (≥1 field). Not in tenant → `404 TABLE_NOT_FOUND`. |
| DELETE | `/tables/:id` | `204`. Table referenced by any order → `409 TABLE_IN_USE`. Not in tenant → `404 TABLE_NOT_FOUND`. |
| POST | `/tables/:id/regenerate-qr` | Mint a new `qrToken` (old QR stops resolving) → returns the table. Not in tenant → `404 TABLE_NOT_FOUND`. |

### Field rules

- `name`: required on create, `minLength 1`. Used for both the human label and the "table number"
  (e.g. `"Bàn 5"`) — there is **no separate `number` column** and none is added (no migration).
- `capacity`: optional integer, `minimum 1`, nullable. Defaults to `null` (column is nullable).
- `status` (`EMPTY` | `OCCUPIED`): **read-only**. Never accepted in create or update bodies; it is
  system-managed by the session lifecycle (US-005 opens an order; future US-5.4 closes it). Create
  always starts a table `EMPTY` (the schema default).
- `qrToken`: **server-generated, never client-supplied**. Minted with `crypto.randomUUID()` on
  create and on regenerate. Unguessable (public in the QR), collision-safe, no new dependency.
- Update body requires `minProperties: 1`; patches only the fields sent.

## Design Notes

- **View:** `TableView { id, name, capacity, qrToken, status }` via `toTableView(row)`. All write
  endpoints and the regenerate action return the table view; GET returns `{ tables: TableView[] }`.
- **Queries:** `list-tables` (restaurant's tables ordered by `name`).
- **Commands:** `create-table` (mints token, returns view), `update-table` (partial patch),
  `delete-table` (in-use guard), `regenerate-qr` (mints a new token on an existing tenant-scoped
  table).

### Delete — in-use guard

Mirrors US-015's `MENU_ITEM_IN_USE`. A table is **refused** while it is referenced by ANY order
(any status, including historical PAID/CANCELLED):

1. Tenant-scoped existence check first → `TABLE_NOT_FOUND` (404) for missing/cross-tenant.
2. Count `orders WHERE table_id = :id` (any status) → if any, `TABLE_IN_USE` (409).
3. Delete under the same tenant scope. `orders.table_id` is a non-cascading FK → `tables.id`, so a
   concurrent order insert between the count and the delete raises SQLSTATE `23503`; map it to the
   same `TABLE_IN_USE` (409) as a race-safe backstop under Neon transaction pooling.

### Regenerate QR

Tenant-scoped `update` of `qr_token` to a fresh `crypto.randomUUID()`:

- Scope `and(eq(tables.id, :id), eq(tables.restaurantId, :tenant))`; `returning()` the row → empty
  result means missing/cross-tenant → `TABLE_NOT_FOUND` (404).
- `qr_token` is `unique`. A `crypto.randomUUID()` (v4) collision is astronomically improbable, so no
  dedicated conflict code is introduced (YAGNI) — a `23505` would bubble through the generic error
  handler, but it is effectively unreachable.
- The old token immediately stops resolving in `GET /api/qr/:qrToken` (US-005) since resolution is
  an exact-match lookup.

## Errors

| Code | Status | Notes |
| --- | --- | --- |
| `TABLE_NOT_FOUND` | **404 (new)** | Table missing or in another restaurant. |
| `TABLE_IN_USE` | **409 (new)** | Table is referenced by an order (any status); delete refused. |

(`INVALID_TABLE` 404 already exists for the *customer* QR-resolve path and is unrelated — it stays.)

## Files

- Create: `src/application/tables/table-view.ts`
- Create: `src/application/tables/list-tables.ts`
- Create: `src/application/tables/create-table.ts`
- Create: `src/application/tables/update-table.ts`
- Create: `src/application/tables/delete-table.ts`
- Create: `src/application/tables/regenerate-qr.ts`
- Create: `src/presentation/http/routes/tables.ts` (`new Elysia({ prefix: '/tables' })`)
- Modify: `src/presentation/http/app.ts` (mount `tablesRoutes`)
- Modify: `src/shared/errors/error-catalog.ts` (add `TABLE_NOT_FOUND`, `TABLE_IN_USE`)
- Test: `test/tables/table-view.test.ts` (unit)
- Test: `test/tables/table-use-cases.test.ts` (DB-backed, self-skipping)
- Test: `test/tables/tables-routes.integration.test.ts` (two-tenant HTTP)

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | `toTableView` maps a row; create mints a non-empty `qrToken` and `status='EMPTY'`; update patches only sent fields; regenerate yields a token different from the prior one. |
| Integration | CRUD persists; tenant-scoped (admin A → restaurant B's table = `404 TABLE_NOT_FOUND`); delete a table with any order → `409 TABLE_IN_USE`; delete an empty table → `204`; regenerate replaces the token (old token no longer resolves, new token resolves via `GET /api/qr/:qrToken`); `status` ignored if sent; RBAC 401/403. |
| E2E | Deferred — covered indirectly: admin creates a table → its `qrToken` resolves through the existing customer QR flow (`GET /api/qr/:qrToken`, US-005); regenerate invalidates the old token. |
| Platform | n/a |
| Release | n/a |

## Harness Delta

None. Reuses `authGuard`, `AppError`/error-catalog, `pgErrorCode`, the Drizzle client, and the
`{ data }` / `{ error }` envelopes.

## Non-Goals (deferred)

- **QR image/PDF export** (US-1.3 PNG/PDF) — deferred; backend exposes the token only, frontend (or
  a later story) renders the QR. Avoids a new rendering dependency (YAGNI).
- A separate `number` column / numeric sort — `name` carries the label (YAGNI; ordered by `name`).
- Admin-set `status` — system-managed by the session lifecycle (US-005 / future US-5.4).
- Bulk table creation / table import — YAGNI.
