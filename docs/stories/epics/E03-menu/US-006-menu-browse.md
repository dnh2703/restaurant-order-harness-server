# US-006 Menu Browse by Category

## Status

planned

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

Add after implementation.
