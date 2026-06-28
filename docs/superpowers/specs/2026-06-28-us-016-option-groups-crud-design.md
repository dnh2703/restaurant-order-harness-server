# US-016 Admin Option-Groups & Options CRUD — Design

**Epic:** E09 Admin CRUD · **Date:** 2026-06-28 · **Depends on:** US-015 menu-items CRUD (merged)

## Goal

Give an `ADMIN` full runtime management of a dish's customization tree — option groups
(`SINGLE`/`MULTI`, required or not) and the options beneath them (`name`, `priceDelta`) —
scoped to their own restaurant, through routes nested under `/api/menu-items/:menuItemId`.

## Current Behavior

`option_groups` and `options` exist as tables and are read by customers as part of the menu
(`GET /api/qr/:qrToken/menu`, US-006). The only write surface today is the seed script. There is
no admin CRUD: option groups and options cannot be created, edited, or removed at runtime.

## Tenancy (key constraint)

Neither `option_groups` nor `options` has a `restaurantId` column. Tenant scope flows one join
deeper than US-015:

```
option → option_group → menu_item → category → restaurant
```

Every operation scopes via an `exists(...)` subquery joining `menu_items` to `categories`
(extending the US-015 pattern by one hop). The restaurant always comes from `auth.restaurantId` —
never from the request body or params. Targeting another restaurant's menu item, group, or option
matches no rows and surfaces as a `404` identical to a truly missing id (cross-tenant existence is
never revealed — same pattern as US-010 staff admin, US-014 categories, US-015 menu-items).

## Target Behavior

All routes guarded by `authGuard` + `.guard({ auth: ['ADMIN'] })`. Option groups nest under a menu
item (per `docs/product/menu.md`); options nest under a group (granular nested CRUD — "Option A").

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/menu-items/:menuItemId/option-groups` | List the item's groups, each with its nested options. Item not in tenant → `404 MENU_ITEM_NOT_FOUND`. |
| POST | `/menu-items/:menuItemId/option-groups` | `{ name, type, isRequired? }` → `201`. Item must belong to the restaurant, else `404 MENU_ITEM_NOT_FOUND`. |
| PATCH | `/menu-items/:menuItemId/option-groups/:groupId` | Partial patch (≥1 field). Group not in tenant → `404 OPTION_GROUP_NOT_FOUND`. |
| DELETE | `/menu-items/:menuItemId/option-groups/:groupId` | `204`. The group's `options` cascade away with it. Group not in tenant → `404 OPTION_GROUP_NOT_FOUND`. |
| POST | `/menu-items/:menuItemId/option-groups/:groupId/options` | `{ name, priceDelta? }` → `201`. Group must belong to the restaurant, else `404 OPTION_GROUP_NOT_FOUND`. |
| PATCH | `/menu-items/:menuItemId/option-groups/:groupId/options/:optionId` | Partial patch (≥1 field). Option not in the tenant's group → `404 OPTION_NOT_FOUND`. |
| DELETE | `/menu-items/:menuItemId/option-groups/:groupId/options/:optionId` | `204`. Option not in the tenant's group → `404 OPTION_NOT_FOUND`. |

### Field rules

**Option group**

- `name`: required on create, `minLength 1`.
- `type`: required on create, enum `SINGLE` | `MULTI`.
- `isRequired`: optional boolean, defaults `false`.
- Update body requires `minProperties: 1`; patches only the fields sent.

**Option**

- `name`: required on create, `minLength 1`.
- `priceDelta`: optional integer, defaults `0`. **May be negative** (e.g. a smaller size at
  −5000₫) — it is added to the menu item price. No lower bound.
- Update body requires `minProperties: 1`; patches only the fields sent.

## Design Notes

- **Views:**
  - `OptionView { id, optionGroupId, name, priceDelta }` via `toOptionView(row)`.
  - `OptionGroupView { id, menuItemId, name, type, isRequired, options: OptionView[] }` via
    `toOptionGroupView(group, options)`. GET returns groups with their nested options; create/patch
    of a group returns the group with its current options array (empty on create).
- **Queries:** `list-option-groups` (groups of an item ordered by `name`, each with its options
  ordered by `name`). `option_groups`/`options` have **no `sort_order` column**, so `name` is the
  deterministic ordering key.
- **Commands:** `create-option-group`, `update-option-group` (partial patch), `delete-option-group`
  (cascades options); `create-option`, `update-option` (partial patch), `delete-option`.

### Tenancy guards

- **Menu item in tenant** (`menuItemInRestaurant`): `exists(select 1 from menu_items join categories
  on categories.id = menu_items.category_id where menu_items.id = :menuItemId and
  categories.restaurant_id = :tenant)`. Used as the pre-check for GET-list and create-group, and as
  the join basis for group scoping.
- **Group in tenant** (`groupScope`): group `:groupId` whose `menu_item_id` resolves to a menu item
  in the tenant (the `exists(...)` above, correlated on `option_groups.menu_item_id`). Used by
  update-group, delete-group, and as the pre-check for create-option.
- **Option in tenant + group:** option `:optionId` whose `option_group_id = :groupId` and whose
  group is in the tenant. Used by update-option and delete-option.

Cross-tenant or missing ids match no rows → the corresponding `*_NOT_FOUND` (404). Order of checks
for the deepest routes: menu item → group → option, each surfacing its own 404 so the client knows
which ancestor is missing (parameterized routes carry the full chain).

### Deletes — no in-use guard

Unlike US-015's `MENU_ITEM_IN_USE`, deletes here are **never blocked by order history**:
`order_item_options` snapshots `option_name` and `price_delta` as plain columns with **no foreign
key** to `options` or `option_groups`. So order history stays intact regardless of later edits or
deletes. The schema already cascades `menu_item → option_groups → options` (both FKs are
`onDelete: 'cascade'`), so deleting a group removes its options; deleting an option removes just
that row. No new `409` code is introduced.

## Errors

| Code | Status | Notes |
| --- | --- | --- |
| `MENU_ITEM_NOT_FOUND` | 404 | Already in catalog (US-007/US-015). Reused for the parent item. |
| `OPTION_GROUP_NOT_FOUND` | **404 (new)** | Group missing or in another restaurant. |
| `OPTION_NOT_FOUND` | **404 (new)** | Option missing, in another restaurant, or not under the named group. |

## Files

- Create: `src/application/option-groups/option-group-view.ts`
- Create: `src/application/option-groups/list-option-groups.ts`
- Create: `src/application/option-groups/create-option-group.ts`
- Create: `src/application/option-groups/update-option-group.ts`
- Create: `src/application/option-groups/delete-option-group.ts`
- Create: `src/application/option-groups/create-option.ts`
- Create: `src/application/option-groups/update-option.ts`
- Create: `src/application/option-groups/delete-option.ts`
- Create: `src/presentation/http/routes/option-groups.ts` (`new Elysia({ prefix: '/menu-items' })`)
- Modify: `src/presentation/http/app.ts` (mount `optionGroupsRoutes`)
- Modify: `src/shared/errors/error-catalog.ts` (add `OPTION_GROUP_NOT_FOUND`, `OPTION_NOT_FOUND`)
- Test: `test/option-groups/option-group-view.test.ts` (unit)
- Test: `test/option-groups/option-group-use-cases.test.ts` (DB-backed, self-skipping)
- Test: `test/option-groups/option-groups-routes.integration.test.ts` (two-tenant HTTP)

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | view mappers (group with nested options; option row); create defaults (`isRequired=false`, `priceDelta=0`); update patches only sent fields |
| Integration | CRUD persists; tenant-scoped (admin A → restaurant B's item/group/option = 404 with the right code); delete group cascades its options; delete option → 204; negative `priceDelta` persists; RBAC 401/403 |
| E2E | admin creates a group + options → they surface in the customer menu read (`GET /api/qr/:qrToken/menu`) under the right dish |
| Platform | n/a |
| Release | n/a |

## Harness Delta

None. Reuses `authGuard`, `AppError`/error-catalog, Drizzle client, and the `{ data }` / `{ error }`
envelopes.

## Non-Goals (deferred)

- Required-group **selection enforcement** at order time → ordering / US-2.3 (`MISSING_REQUIRED_OPTION`
  already exists in the catalog for that work).
- `sort_order` columns / bulk reorder for groups or options — YAGNI (ordered by `name`).
- Aggregate replace-all endpoint and realtime menu push — YAGNI.
