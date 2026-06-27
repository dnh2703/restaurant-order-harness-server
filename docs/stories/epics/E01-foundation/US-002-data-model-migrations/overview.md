# Overview — US-002 Data Model + Migrations

## Current Behavior

After US-001 the app boots and connects to Neon, but there is no domain schema. No
tables exist beyond what a fresh database provides.

## Target Behavior

The full schema from `docs/product/data-model.md` exists as Drizzle models with
checked-in migrations:

- All tables, enums, foreign keys, and defaults.
- Partial unique index `orders(table_id) WHERE status = 'OPEN'`.
- Performance indexes (qr_token, kitchen queue, bill lookups, active refresh tokens).
- A deterministic seed (one restaurant, a few tables, categories, dishes, options,
  and staff users) for integration/E2E tests.

## Affected Users

- All roles indirectly — every later story reads this schema.

## Affected Product Docs

- `docs/product/data-model.md` (source of truth)
- `docs/product/overview.md`

## Non-Goals

- Repository/use-case code.
- Auth logic (only the `users` / `refresh_tokens` tables, not the flows).
- Any API behavior change.
