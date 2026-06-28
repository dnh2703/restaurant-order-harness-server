# Overview — US-015 Admin Menu-Items CRUD

## Current Behavior

Customers read menu items via `GET /api/qr/:qrToken/menu` (US-006), and menu items already exist
as a table (`menu_items`). The only write surfaces today are the seed script and US-012
`set-item-availability` (the kitchen sold-out toggle). There is no admin CRUD: items cannot be
added, edited, moved between categories, repriced, or removed at runtime.

## Target Behavior

An `ADMIN`, scoped to their own restaurant, manages menu items through `/api/menu-items`:

- **List** — all items of the admin's restaurant (joined through `categories`), ordered by
  category (`sortOrder`, `name`) then item (`sortOrder`, `name`). Accepts optional
  `?categoryId` filter.
- **Create** — `{ categoryId, name, price, description?, imageUrl?, isAvailable?, sortOrder? }`;
  `isAvailable` defaults to `true`, `sortOrder` to `0`. Returns `201`. The target category must
  belong to the restaurant, else `404 CATEGORY_NOT_FOUND`.
- **Update** — `{ categoryId?, name?, price?, description?, imageUrl?, isAvailable?, sortOrder? }`
  (at least one field); patches only the fields sent. If `categoryId` is provided, the item is
  moved to that category (which must belong to the restaurant).
- **Delete** — removes the item and returns `204`, but is **blocked with `409 MENU_ITEM_IN_USE`**
  when any `order_items` still reference it (history must stay intact — `order_items` snapshots
  `nameSnapshot` and `unitPrice`). `option_groups` and `options` beneath the item cascade away.

Every route is guarded by `authGuard` + `.guard({ auth: ['ADMIN'] })` and is tenant-scoped: the
restaurant always comes from `auth.restaurantId`, never the request body or params.

`menu_items` has **no `restaurantId` column** — tenant scope flows through
`categoryId → categories.restaurantId`. Every operation scopes via an `exists(...)` subquery on
`categories`. Targeting another restaurant's item matches no rows and surfaces as
`404 MENU_ITEM_NOT_FOUND` — cross-tenant existence is never revealed (same pattern as US-010 staff
admin and US-014 categories).

## Affected Users

- `ADMIN` — gains full menu-item management (create, rename/reprice/reorder, move between
  categories, toggle availability, delete).
- `Customer` — sees newly created / updated items on the next menu read (US-006); the menu read
  is pull-based, so no realtime push is added in this slice.
- `Kitchen` — `isAvailable` is the same column written by the US-012 kitchen sold-out toggle; the
  admin surface and kitchen surface share it with no conflict.

## Affected Product Docs

- `docs/product/menu.md` (US-6.1, Admin Administration)
- `docs/product/api-conventions.md`

## Design Notes

- **View:** `MenuItemView { id, categoryId, name, description, price, imageUrl, isAvailable, sortOrder }`
  via `toMenuItemView(row)`.
- **Queries:** `list-menu-items` (join categories, scope by restaurantId, optional categoryId filter,
  ordered by category sortOrder/name then item sortOrder/name).
- **Commands:** `create-menu-item`, `update-menu-item` (partial patch + optional move),
  `delete-menu-item` (count guard then delete, with `23503` backstop).
- **Tenancy guard:** `exists(select categories.id where categories.id = menu_items.category_id and
  categories.restaurant_id = restaurantId)` reused across list/update/delete; create/move verify
  the named `categoryId` belongs to the restaurant with a direct `select` pre-check.
- **API:** `GET/POST/PATCH/DELETE /api/menu-items[/:id]`, ADMIN-guarded, tenant-scoped.
- **Tables:** `menu_items` (exists — no migration). Delete guard reads `order_items` count.
- **Delete guard (race-safe):** (1) scope-check item belongs to tenant → else `MENU_ITEM_NOT_FOUND`;
  (2) count `order_items` referencing the item; `> 0` → `MENU_ITEM_IN_USE` (clean 409); (3) DELETE
  wrapped in try/catch mapping SQLSTATE `23503` → `MENU_ITEM_IN_USE` as a backstop for a racing
  `order_items` insert.
- **Create/move category-scope backstop:** The category pre-check is the primary tenant guard (the
  FK only checks existence, not tenant). SQLSTATE `23503` on insert/update → `CATEGORY_NOT_FOUND`
  as backstop for the category being deleted between pre-check and write.
- **Errors:**
  - `MENU_ITEM_NOT_FOUND` (404) — already in catalog (US-007); reused.
  - `CATEGORY_NOT_FOUND` (404) — already in catalog (US-014); reused.
  - `MENU_ITEM_IN_USE` (409) — **new** in this story; cannot delete an item still referenced by
    order history.
- **Use-cases:** `src/application/menu-items/{menu-item-view,list-menu-items,create-menu-item,
  update-menu-item,delete-menu-item}.ts`; route `src/presentation/http/routes/menu-items.ts`
  mounted in `app.ts`.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | view mapper; create defaults (`isAvailable=true`, `sortOrder=0`); update patches only sent fields; delete-guard blocks when order_items count > 0 |
| Integration | CRUD persists; tenant-scoped (admin A cannot see/patch/delete restaurant B's item → 404; create/move into B's category → 404 CATEGORY_NOT_FOUND); delete ordered item → 409 MENU_ITEM_IN_USE; delete unordered → 204 (cascades its option_groups); RBAC 401/403 |
| E2E | admin creates an item → it appears in the customer menu read (`GET /api/qr/:qrToken/menu`) under the right category |
| Platform | n/a |
| Release | n/a |

## Harness Delta

None. Reuses existing `authGuard`, `AppError`/error-catalog, Drizzle client, and the `{ data }` /
`{ error }` envelope patterns.

## Non-Goals

- Option-groups / options CRUD — deferred to US-016.
- Bulk reorder endpoint, soft-delete / archive, and realtime menu push — deferred (YAGNI).
- Image **upload** — only an `imageUrl` string is accepted in this slice.
