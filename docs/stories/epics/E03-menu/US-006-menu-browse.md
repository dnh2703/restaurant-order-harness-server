# US-006 Menu Browse by Category

## Status

implemented

## Lane

normal

## Product Contract

Expose the customer menu read for a QR session: dishes grouped by category with image,
price, description, availability, and option groups/options. Implements SPEC US-2.1
(US-2.2 search and US-2.3 option selection are follow-up slices in E03).

## Relevant Product Docs

- `docs/product/menu.md`
- `docs/product/data-model.md`

## Acceptance Criteria

- `GET /api/qr/:qrToken/menu` returns categories ordered by `sort_order`, each with its
  `menu_items` (ordered by `sort_order`).
- Each dish includes name, image, price (VND int), description, `is_available`, and its
  option groups + options.
- `is_available = false` dishes are returned with a flag so the FE can dim + label
  "Sold out".
- Read is scoped to the QR session's restaurant; no cross-restaurant leakage.

## Design Notes

- Commands: none.
- Queries: `GetMenuForRestaurant` (categories + items + option groups + options).
- API: `GET /api/qr/:qrToken/menu`.
- Tables: `categories`, `menu_items`, `option_groups`, `options`.
- Domain rules: grouping + ordering; availability flag.
- UI surfaces: customer menu list.

## Validation

`scripts/bin/harness-cli story update --id US-006 --unit 1 --integration 1 --e2e 0 --platform 0`

| Layer | Expected proof |
| --- | --- |
| Unit | grouping/sort assembly; option nesting |
| Integration | seeded menu returns correct grouped shape; sold-out flag present; avoids SELECT * over-fetch |
| E2E | customer opens menu grouped by category |
| Platform | n/a |
| Release | n/a |

## Harness Delta

None expected; depends on US-002 schema. Search (US-2.2) tracked as candidate.

## Evidence

Verified on a live Neon branch, 2026-06-27.

- **API:** `GET /api/qr/:qrToken/menu` (`src/presentation/http/routes/qr.ts`) →
  `getMenuForQrToken` (`src/application/menu/get-menu.ts`). Returns
  `{ data: { categories: [{ id, name, items: [{ id, name, description, price, imageUrl,
  isAvailable, optionGroups: [{ id, name, type, isRequired, options: [{ id, name,
  priceDelta }] }] }] }] } }`.
- **Invalid token:** unknown/regenerated `qr_token` → `404 INVALID_TABLE` (reuses the
  US-005 code), matching the QR session route.
- **Grouping & ordering:** categories ordered by `sort_order` then `name`; dishes by
  `sort_order` then `name`. Empty categories still appear (`items: []`). Sold-out dishes
  stay in the list with `isAvailable: false` (FE dims + labels "Sold out").
- **Scoping:** every read is joined through `categories.restaurant_id`, so a token only
  ever returns its own restaurant's menu (no cross-restaurant leakage).
- **Efficiency:** four explicit-column reads (categories / items / option groups /
  options) run in parallel and are stitched in memory — fixed query count regardless of
  menu size (no N+1), no `SELECT *`.
- **Unit** (`test/get-menu.test.ts`): `groupMenu` proves grouping, input-order
  preservation, empty category, option nesting, and the sold-out flag without a DB;
  unknown token throws `INVALID_TABLE`/404 via a fake lookup.
- **Integration** (`test/menu.test.ts`, live Neon): seeded menu (inserted out of
  `sort_order`) returns the correct grouped/ordered shape with nested options and the
  sold-out flag; a second restaurant's rows never leak into the read; unknown token → 404.
  Self-skips when the DB is unmigrated/unreachable (`test/support/db.ts`).
- **Quality gates:** `typecheck`, `oxlint`, `prettier` clean. `menu` + `get-menu` 9 pass.
