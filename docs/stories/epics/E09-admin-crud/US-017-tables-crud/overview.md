# Overview — US-017 Admin Tables CRUD + QR Token

## Current Behavior

`tables` exists as a table and is read by the customer QR flow (`resolveTableSession`, US-005) and
the menu read (US-006), both by exact `qr_token` match. The only write surface today is the seed
script (`src/infrastructure/database/seed.ts`, friendly tokens like `qr-table-01`). There is no
admin CRUD: tables cannot be created, edited, deleted, or re-tokenized at runtime.

## Target Behavior

An `ADMIN`, scoped to their own restaurant, manages tables through routes mounted under `/api/tables`,
guarded by `authGuard` + `.guard({ auth: ['ADMIN'] })`:

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/tables` | List the restaurant's tables, ordered by `name`. |
| POST | `/tables` | `{ name, capacity? }` → `201`. Server mints `qrToken`; `status` defaults `EMPTY`. |
| PATCH | `/tables/:id` | Partial patch `{ name?, capacity? }` (≥1 field). Not in tenant → `404 TABLE_NOT_FOUND`. |
| DELETE | `/tables/:id` | `204`. Table with an `OPEN` order → `409 TABLE_IN_USE`. Not in tenant → `404 TABLE_NOT_FOUND`. |
| POST | `/tables/:id/regenerate-qr` | Mint a new `qrToken` (old QR stops resolving) → returns the table. Not in tenant → `404 TABLE_NOT_FOUND`. |

Every route is guarded by `authGuard` + `.guard({ auth: ['ADMIN'] })` and tenant-scoped: the
restaurant always comes from `auth.restaurantId`, never the request body or params.

## Affected Users

- `ADMIN` — gains full table management for their restaurant (create, rename/re-capacity, delete,
  regenerate QR).
- `Customer` — resolves the QR token through the existing customer flow (`GET /api/qr/:qrToken`,
  US-005); a regenerated token invalidates the old QR immediately.

## Affected Product Docs

- `docs/product/spec-intake.md` (US-017 Admin Tables CRUD entry)

## Design Notes

- **View:** `TableView { id, name, capacity, qrToken, status }` via `toTableView(row)`. All write
  endpoints and the regenerate action return the table view wrapped in `{ data: { table } }`;
  GET returns `{ data: { tables: TableView[] } }`.
- **Tenancy:** `tables` has its own `restaurant_id` column (FK → `restaurants`), so tenant scope is
  **direct** — simpler than US-015/US-016, which join through `categories`. Every operation scopes by
  `and(eq(tables.id, :id), eq(tables.restaurantId, :tenant))`; list filters by `tables.restaurantId`.
  A missing or cross-tenant id matches no rows and surfaces as `404 TABLE_NOT_FOUND`; cross-tenant
  existence is never revealed (same pattern as US-010/US-014/US-015/US-016).
- **QR token:** `qrToken` is **server-generated, never client-supplied**. Minted with
  `crypto.randomUUID()` (v4) on create and on regenerate. Unguessable, collision-safe, no new
  dependency. Client-supplied `qrToken` on create/update is stripped by the TypeBox body schema.
- **Status:** `status` (`EMPTY` | `OCCUPIED`) is **read-only**. Never accepted in create or update
  bodies (stripped by schema). Create always starts a table `EMPTY` (the schema default); transitions
  are system-managed by the session lifecycle (US-005 opens an order; future US-5.4 closes it).
- **Delete — in-use guard:** Mirrors US-015's `MENU_ITEM_IN_USE`. A table is refused while it still
  has an `OPEN` order: existence check first → `TABLE_NOT_FOUND` (404) for missing/cross-tenant;
  count `orders WHERE table_id = :id AND status = 'OPEN'` → if any, `TABLE_IN_USE` (409).
  `orders.table_id` is a non-cascading FK, so a concurrent order insert raises SQLSTATE `23503`
  (mapped to `TABLE_IN_USE` as a race-safe backstop under Neon transaction pooling).
- **Regenerate QR:** Tenant-scoped `UPDATE qr_token = randomUUID()` with `RETURNING`; empty result →
  `TABLE_NOT_FOUND`. The old token immediately stops resolving in `GET /api/qr/:qrToken` (US-005).
- **Queries/Commands:** `list-tables`, `create-table`, `update-table`, `delete-table`,
  `regenerate-qr` in `src/application/tables/`. Route: `src/presentation/http/routes/tables.ts`
  (prefix `/tables`), mounted in `app.ts`.
- **No migration:** `tables` already exists in the schema (US-001/US-002).

## Errors

| Code | Status | Notes |
| --- | --- | --- |
| `TABLE_NOT_FOUND` | **404 (new)** | Table missing or in another restaurant. |
| `TABLE_IN_USE` | **409 (new)** | Table still has an `OPEN` order; delete refused. |

(`INVALID_TABLE` 404 already exists for the *customer* QR-resolve path and is unrelated — it stays.)

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | `toTableView` maps a row; create mints a non-empty `qrToken` and defaults `status='EMPTY'`; update patches only sent fields; regenerate yields a different token. |
| Integration | CRUD persists; tenant-scoped (admin A → restaurant B's table = `404 TABLE_NOT_FOUND`); delete a table with an `OPEN` order → `409 TABLE_IN_USE`; delete an empty table → `204`; regenerate replaces the token (old token no longer resolves, new token resolves via `GET /api/qr/:qrToken`); `status` and `qrToken` stripped if sent; empty-PATCH body → `400`; RBAC 401/403. |
| E2E | Deferred — token resolves via the existing customer QR flow (`GET /api/qr/:qrToken`, US-005); regenerate invalidates the old token. |
| Platform | n/a |
| Release | n/a |

## Harness Delta

None. Reuses existing `authGuard`, `AppError`/error-catalog, `pgErrorCode`, Drizzle client, and the
`{ data }` / `{ error }` envelope patterns.

## Non-Goals

- **QR image/PDF export** (US-1.3 PNG/PDF) — deferred; backend exposes the token only. Avoids a new
  rendering dependency (YAGNI).
- A separate `number` column / numeric sort — `name` carries the label (YAGNI; ordered by `name`).
- Admin-set `status` — system-managed by the session lifecycle (US-005 / future US-5.4).
- Bulk table creation / table import — YAGNI.
