# Overview — US-014 Admin Categories CRUD

## Current Behavior

Customers read the menu grouped by category over `GET /api/qr/:qrToken/menu` (US-006), and
categories already exist as a table (`categories`: `id`, `restaurant_id`, `name`, `sort_order`).
But there is no admin surface: categories can only be created by the seed script, never managed
at runtime. There is no way for an `ADMIN` to add, rename, reorder, or remove a category.

## Target Behavior

An `ADMIN`, scoped to their own restaurant, manages categories through `/api/categories`:

- **List** — all categories of the admin's restaurant, ordered by `sortOrder` then `name`.
- **Create** — `{ name, sortOrder? }`; `sortOrder` defaults to `0`. Returns `201`.
- **Update** — `{ name?, sortOrder? }` (at least one field); patches only the fields sent.
- **Delete** — removes the category and returns `204`, but is **blocked with
  `409 CATEGORY_NOT_EMPTY`** when any `menu_items` still reference it (the FK is `NOT NULL` with
  no cascade, so deleting a non-empty category would orphan dishes / break the bill history path).

Every route is guarded by `authGuard` + `.guard({ auth: ['ADMIN'] })` and is tenant-scoped: the
restaurant always comes from `auth.restaurantId`, never the request body/params. Targeting another
restaurant's category matches no rows and surfaces as `404 CATEGORY_NOT_FOUND` — the same response
a truly missing id gets, so cross-tenant existence is never revealed (same pattern as US-010 staff
admin).

## Affected Users

- `ADMIN` — gains full category management.
- `Customer` — sees newly created / renamed / reordered categories on the next menu read (US-006);
  the menu read is pull-based, so no realtime push is added in this slice.

## Affected Product Docs

- `docs/product/menu.md` (US-6.1, Admin Administration)
- `docs/product/api-conventions.md`

## Design Notes

- **Queries:** `list-categories` (ordered), existence/scope re-read before mutate.
- **Commands:** `create-category`, `update-category` (partial patch), `delete-category`
  (count guard then delete).
- **API:** `GET/POST/PATCH/DELETE /api/categories[...]`, ADMIN-guarded, tenant-scoped.
- **Tables:** `categories` (exists — no migration). Delete guard reads `menu_items` count.
- **Domain rules:** tenant scope via `and(eq(categories.id, id), eq(categories.restaurantId,
  restaurantId))`; non-empty delete refused `CATEGORY_NOT_EMPTY`.
- **Errors (new):** `CATEGORY_NOT_FOUND` (404), `CATEGORY_NOT_EMPTY` (409).
- **Use-cases:** `src/application/categories/{category-view,list-categories,create-category,
  update-category,delete-category}.ts`; route `src/presentation/http/routes/categories.ts` mounted
  in `app.ts`.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | create defaults `sortOrder=0`; update patches only sent fields; delete-guard blocks when item count > 0 |
| Integration | CRUD persists; tenant-scoped (admin A cannot see/patch/delete restaurant B's category → 404); delete non-empty → 409; delete empty → 204 |
| E2E | admin creates a category → it appears in the customer menu read (`GET /api/qr/:qrToken/menu`) under the right group |
| Platform | n/a |
| Release | n/a |

## Harness Delta

None. Reuses existing `authGuard`, `AppError`/error-catalog, and Drizzle client patterns.

## Non-Goals

- Bulk reorder endpoint, soft-delete / archive, and realtime category push — deferred (YAGNI).
- Menu-items, option-groups, and table/QR admin — separate E09 stories (US-015 / US-016 / US-017).
