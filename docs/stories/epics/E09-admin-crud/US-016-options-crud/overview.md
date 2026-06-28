# Overview — US-016 Admin Option-Groups & Options CRUD

## Current Behavior

`option_groups` and `options` exist as tables and are read by customers as part of the menu
(`GET /api/qr/:qrToken/menu`, US-006). The only write surface today is the seed script. There is no
admin CRUD: option groups (a dish's `SINGLE`/`MULTI`, required-or-not customization groups) and the
options beneath them (`name`, `priceDelta`) cannot be created, edited, or removed at runtime.

## Target Behavior

An `ADMIN`, scoped to their own restaurant, manages a dish's option tree through routes nested under
`/api/menu-items/:menuItemId`. Option groups nest under the menu item; options nest under a group
(granular nested CRUD):

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/menu-items/:menuItemId/option-groups` | List the item's groups, each with its nested options (ordered by `name`). Item not in tenant → `404 MENU_ITEM_NOT_FOUND`. |
| POST | `/menu-items/:menuItemId/option-groups` | `{ name, type, isRequired? }` → `201`. `isRequired` defaults `false`. Item must belong to the restaurant, else `404 MENU_ITEM_NOT_FOUND`. |
| PATCH | `/menu-items/:menuItemId/option-groups/:groupId` | Partial patch (≥1 field). Group not under the tenant's item → `404 OPTION_GROUP_NOT_FOUND`. |
| DELETE | `/menu-items/:menuItemId/option-groups/:groupId` | `204`. The group's `options` cascade away with it. |
| POST | `/menu-items/:menuItemId/option-groups/:groupId/options` | `{ name, priceDelta? }` → `201`. `priceDelta` defaults `0`. Group must belong to the restaurant, else `404 OPTION_GROUP_NOT_FOUND`. |
| PATCH | `/menu-items/:menuItemId/option-groups/:groupId/options/:optionId` | Partial patch (≥1 field). Option not under the named group → `404 OPTION_NOT_FOUND`. |
| DELETE | `/menu-items/:menuItemId/option-groups/:groupId/options/:optionId` | `204`. |

Every route is guarded by `authGuard` + `.guard({ auth: ['ADMIN'] })` and tenant-scoped: the
restaurant always comes from `auth.restaurantId`, never the request body or params.

`option_groups` and `options` have **no `restaurantId` column** — tenant scope flows one join deeper
than US-015: `option → option_group → menu_item → category → restaurant`. A `scope.ts` helper
enforces it (`assertMenuItemInRestaurant`, `assertGroupInRestaurant`). Targeting another
restaurant's item/group/option matches no rows and surfaces as the matching `404` — cross-tenant
existence is never revealed (same pattern as US-010 staff admin, US-014 categories, US-015 menu
items). Check order on nested routes is menu item → group → option, so the client learns which
ancestor is missing.

Fields: `priceDelta` is a signed integer and **may be negative** (e.g. a smaller size at −5000₫);
`option_groups`/`options` have no `sort_order` column, so both are ordered by `name`.

## Affected Users

- `ADMIN` — gains full option-tree management for any dish in their restaurant (create groups,
  rename/retype/toggle-required, create/reprice/rename/delete options).
- `Customer` — sees newly created / updated option groups and options on the next menu read
  (US-006); the menu read is pull-based, so no realtime push is added in this slice.

## Affected Product Docs

- `docs/product/menu.md` (US-6.3, Option groups & options)

## Design Notes

- **Views:** `OptionView { id, optionGroupId, name, priceDelta }`;
  `OptionGroupView { id, menuItemId, name, type, isRequired, options: OptionView[] }` via
  `toOptionView(row)` / `toOptionGroupView(group, optionRows)`.
- **Queries:** `list-option-groups` (groups of an item ordered by `name`, options fetched in one
  `inArray` query and grouped in memory — no N+1).
- **Commands:** `create/update/delete-option-group`, `create/update/delete-option`.
- **Tenancy guard:** `scope.ts` — `assertMenuItemInRestaurant` (join `menu_items`→`categories`,
  filter `restaurantId`) and `assertGroupInRestaurant` (item check, then group exists under that
  item). Group/option writes scope by `id` + parent id; no-rows → the matching `*_NOT_FOUND`.
- **Deletes — no in-use guard:** `order_item_options` snapshots `optionName`/`priceDelta` as plain
  columns with **no FK** to `options`/`option_groups`, so order history is never blocked. The schema
  already cascades `menu_item → option_groups → options`; deleting a group cascades its options.
  No new `409` code (unlike US-015's `MENU_ITEM_IN_USE`). SQLSTATE `23503` on insert is mapped as a
  race-safe backstop only (group/item deleted mid-write).
- **API:** `GET/POST/PATCH/DELETE` nested under `/api/menu-items/:menuItemId/option-groups[...]`,
  ADMIN-guarded, tenant-scoped. The route shares the `/menu-items` prefix with the US-015 route
  (different path depths — no collision).
- **Tables:** `option_groups`, `options` (exist — no migration).
- **Errors:**
  - `MENU_ITEM_NOT_FOUND` (404) — already in catalog (US-007/US-015); reused for the parent item.
  - `OPTION_GROUP_NOT_FOUND` (404) — **new** in this story.
  - `OPTION_NOT_FOUND` (404) — **new** in this story.
- **Use-cases:** `src/application/option-groups/{option-group-view,scope,list-option-groups,
  create-option-group,update-option-group,delete-option-group,create-option,update-option,
  delete-option}.ts`; route `src/presentation/http/routes/option-groups.ts` mounted in `app.ts`.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | view mappers (group with nested options; option row; negative `priceDelta`); create defaults (`isRequired=false`, `priceDelta=0`); update patches only sent fields |
| Integration | nested CRUD persists; tenant-scoped (admin A → restaurant B's item/group/option → correct 404); delete group cascades its options; delete option → 204; negative `priceDelta` persists; invalid `type` → 400; RBAC 401/403 |
| E2E | admin creates a group + options → they surface in the customer menu read (`GET /api/qr/:qrToken/menu`) under the right dish |
| Platform | n/a |
| Release | n/a |

## Harness Delta

None. Reuses existing `authGuard`, `AppError`/error-catalog, `pgErrorCode`, Drizzle client, and the
`{ data }` / `{ error }` envelope patterns.

## Non-Goals

- Required-group **selection enforcement** at order time — ordering / US-2.3 (`MISSING_REQUIRED_OPTION`
  already exists in the catalog for that work).
- `sort_order` columns / bulk reorder for groups or options — deferred (YAGNI; ordered by `name`).
- Aggregate replace-all endpoint and realtime menu push — deferred (YAGNI).
