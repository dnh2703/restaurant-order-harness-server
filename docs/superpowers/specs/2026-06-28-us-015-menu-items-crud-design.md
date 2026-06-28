# US-015 Admin Menu-Items CRUD — Design

**Epic:** E09 Admin CRUD · **Date:** 2026-06-28 · **Depends on:** US-014 categories CRUD (merged)

## Goal

Give an `ADMIN` full runtime management of menu items — create, list, rename/reprice/reorder/move,
toggle availability, and delete — scoped to their own restaurant, through `/api/menu-items`.

## Current Behavior

`menu_items` exist as a table and are read by customers via `GET /api/qr/:qrToken/menu` (US-006).
The only write surfaces today are the seed script and US-012 `set-item-availability` (kitchen
sold-out toggle). There is no admin CRUD: items cannot be added, edited, moved between categories,
or removed at runtime.

## Tenancy (key constraint)

`menu_items` has **no `restaurantId` column**. Tenant scope flows through
`categoryId → categories.restaurantId`. Every operation scopes via an `exists(...)` subquery on
`categories` (the exact pattern already used in `src/application/kitchen/set-item-availability.ts`).
The restaurant always comes from `auth.restaurantId` — never from the request body or params.
Targeting another restaurant's item matches no rows and surfaces as `404 MENU_ITEM_NOT_FOUND`,
identical to a truly missing id (cross-tenant existence is never revealed — same pattern as US-010
staff admin and US-014 categories).

## Target Behavior

All routes guarded by `authGuard` + `.guard({ auth: ['ADMIN'] })`, prefix `/api/menu-items`:

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/menu-items` | List all items of the admin's restaurant (join through `categories`), optional `?categoryId` filter. Ordered by category (`sortOrder`, `name`) then item (`sortOrder`, `name`). |
| POST | `/menu-items` | `{ categoryId, name, price, description?, imageUrl?, isAvailable?, sortOrder? }` → `201`. The target category must belong to the restaurant, else `404 CATEGORY_NOT_FOUND`. |
| PATCH | `/menu-items/:id` | Partial patch (≥1 field). If `categoryId` is sent, the new category must belong to the restaurant (move item). Item not in tenant → `404 MENU_ITEM_NOT_FOUND`. |
| DELETE | `/menu-items/:id` | `204`. Blocked with `409 MENU_ITEM_IN_USE` when any `order_items` still reference it. `option_groups`/`options` cascade away with the item. |

### Field rules

- `name`: required on create, `minLength 1`.
- `price`: required on create, integer **≥ 0** (VND — never float).
- `categoryId`: required on create (uuid); optional on update (moves the item).
- `description`, `imageUrl`: optional, nullable text (image is a URL string only — no upload).
- `isAvailable`: optional boolean, defaults `true`. Admin update writes the **same column** as the
  US-012 kitchen sold-out toggle — this is the admin-facing surface of US-6.2; no conflict.
- `sortOrder`: optional integer, defaults `0`.
- Update body requires `minProperties: 1`.

## Design Notes

- **View:** `MenuItemView { id, categoryId, name, description, price, imageUrl, isAvailable, sortOrder }`
  via `toMenuItemView(row)`.
- **Queries:** `list-menu-items` (join categories, scope, optional categoryId, ordered).
- **Commands:** `create-menu-item`, `update-menu-item` (partial patch + optional move),
  `delete-menu-item` (count guard then delete).
- **Tenancy guard:** `exists(select categories.id where categories.id = menu_items.category_id and
  categories.restaurant_id = restaurantId)` reused across list/update/delete; create/move verify
  the named `categoryId` belongs to the restaurant with a direct `select` pre-check.

### Delete guard (race-safe under Neon transaction pooling)

1. Scope-check the item belongs to the tenant → else `MENU_ITEM_NOT_FOUND`.
2. Count `order_items` referencing the item; `> 0` → `MENU_ITEM_IN_USE` (clean 409).
3. `DELETE` (single autocommit statement) wrapped in try/catch mapping SQLSTATE `23503` →
   `MENU_ITEM_IN_USE` — backstop for an `order_items` insert racing the delete.

`order_items` references `menu_items` with a plain `references()` (restrict), so a delete of an
ordered item raises `23503`. History stays intact because `order_items` snapshots `nameSnapshot`
and `unitPrice`. `option_groups` (and `options` beneath them) reference `menu_items` with
`onDelete: 'cascade'`, so they are removed with the item.

### Create / move category-scope backstop

The category pre-check (`select categories where id = :categoryId and restaurantId = :tenant`) is
the **primary** tenant guard — the FK on `menu_items.category_id` only checks existence, not tenant,
so a cross-tenant `categoryId` that exists would pass the FK. Map SQLSTATE `23503` on insert/update
→ `CATEGORY_NOT_FOUND` as a backstop for the category being deleted between pre-check and write.

## Errors

| Code | Status | Notes |
| --- | --- | --- |
| `MENU_ITEM_NOT_FOUND` | 404 | Already in catalog (US-007). |
| `CATEGORY_NOT_FOUND` | 404 | Already in catalog (US-014). |
| `MENU_ITEM_IN_USE` | **409 (new)** | Cannot delete an item still referenced by order history. |

## Files

- Create: `src/application/menu-items/menu-item-view.ts`
- Create: `src/application/menu-items/list-menu-items.ts`
- Create: `src/application/menu-items/create-menu-item.ts`
- Create: `src/application/menu-items/update-menu-item.ts`
- Create: `src/application/menu-items/delete-menu-item.ts`
- Create: `src/presentation/http/routes/menu-items.ts`
- Modify: `src/presentation/http/app.ts` (mount `menuItemsRoutes`)
- Modify: `src/shared/errors/error-catalog.ts` (add `MENU_ITEM_IN_USE`)
- Test: `test/menu-items/menu-item-view.test.ts` (unit)
- Test: `test/menu-items/menu-item-use-cases.test.ts` (DB-backed, self-skipping)
- Test: `test/menu-items/menu-items-routes.integration.test.ts` (two-tenant HTTP)

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | view mapper; create defaults (`isAvailable=true`, `sortOrder=0`); update patches only sent fields; delete-guard blocks when order_items count > 0 |
| Integration | CRUD persists; tenant-scoped (admin A cannot see/patch/delete restaurant B's item → 404; create/move into B's category → 404 CATEGORY_NOT_FOUND); delete ordered item → 409 MENU_ITEM_IN_USE; delete unordered → 204 (cascades its option_groups); RBAC 401/403 |
| E2E | admin creates an item → it appears in the customer menu read (`GET /api/qr/:qrToken/menu`) under the right category |
| Platform | n/a |
| Release | n/a |

## Harness Delta

None. Reuses `authGuard`, `AppError`/error-catalog, Drizzle client, and the `{ data }` / `{ error }`
envelopes.

## Non-Goals (deferred)

- Option-groups / options CRUD → US-016.
- Bulk reorder endpoint, soft-delete / archive, image **upload** (only an `imageUrl` string is
  accepted), and realtime menu push — YAGNI.
