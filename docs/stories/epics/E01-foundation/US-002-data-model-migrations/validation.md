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

Add after verification: migration output, `\d` table listing or index assertions, and
the failing-insert proof for the OPEN-order unique index.
