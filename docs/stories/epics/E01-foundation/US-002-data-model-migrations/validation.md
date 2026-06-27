# Validation — US-002 Data Model + Migrations

## Proof Strategy

Migrations apply cleanly on a fresh Neon branch and create exactly the schema in
`docs/product/data-model.md`, including the one-OPEN-order invariant and the required
indexes. A deterministic seed loads without error.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | enum value sets; schema module compiles; seed builds expected row counts |
| Integration | migrate a clean Neon branch → all tables/enums/indexes present; inserting a second OPEN order for the same table fails the partial unique index |
| E2E | n/a (no user-facing flow yet) |
| Platform | migration applies on a Neon branch then the primary branch; rollback/redo is clean |
| Performance | kitchen-queue and bill-lookup indexes exist (EXPLAIN uses them on seeded data) |
| Logs/Audit | migration + seed logs list applied steps and row counts |

## Fixtures

Deterministic seed: 1 restaurant; 1 admin + 1 kitchen + 1 cashier user (hashed
passwords); 3 tables with fixed `qr_token`s; 2 categories; 4 dishes with one option
group each; no orders.

## Commands

Add after the toolchain exists, e.g.:

```text
bun run db:generate   # drizzle-kit generate
bun run db:migrate    # apply to DATABASE_URL (Neon branch)
bun run db:seed
```

Then register: `scripts/bin/harness-cli story update --id US-002 --verify "<test cmd>"`.

## Acceptance Evidence

Verified 2026-06-27 on Neon branch `us-002-data-model` (`br-broad-poetry-atmtioet`,
parent `production`, expires 2026-07-04).

- **Migration**: `drizzle/0000_heavy_toro.sql` applied via `drizzle-kit migrate` —
  `migrations applied successfully` (13 tables, 8 enums, all FKs + indexes).
- **Invariant index** (`pg_indexes`):
  `CREATE UNIQUE INDEX orders_one_open_per_table_idx ON public.orders USING btree
  (table_id) WHERE (status = 'OPEN'::order_status)`.
- **Failing-insert proof**: a second `OPEN` order for the same `table_id` is rejected
  with SQLSTATE `23505` (unique_violation); a `PAID`-then-`OPEN` sequence is allowed.
  Covered by `test/orders-invariant.test.ts` (note: Drizzle wraps driver errors — the
  pg `code` is read from `error.cause`).
- **Seed**: `bun run db:seed` loaded exact counts — restaurants 1, users 3, tables 3,
  categories 2, menu_items 4, option_groups 4, options 8.
- **Suite**: `bun test` 12 pass / 0 fail; `tsc`, `oxlint`, `prettier` clean.
- **Registered verify** (`harness-cli story verify US-002`, DB-free gate):
  `bun run typecheck && bun test test/schema.test.ts test/seed.test.ts` → pass.

Not applied to the `production` branch yet — run `bun run db:migrate` against the
production `DATABASE_URL` when ready to promote.
