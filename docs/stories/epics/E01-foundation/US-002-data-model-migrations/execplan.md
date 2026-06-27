# Exec Plan — US-002 Data Model + Drizzle Migrations

## Goal

Define the full database schema (SPEC §3) as Drizzle models with checked-in migrations,
including the invariants and indexes that every later story depends on.

## Scope

In scope:

- Drizzle schema for all tables in `docs/product/data-model.md`.
- Postgres enums, partial unique index for one OPEN order per table, and the indexes
  listed in the data-model doc.
- Migration files + a seed for local/test data.

Out of scope:

- Repository implementations and use-cases (later stories).
- Any HTTP endpoint behavior beyond what US-001 health already provides.

## Risk Classification

Risk flags:

- Data model (schema, uniqueness, migration).
- Public contracts (shape that API responses will mirror).
- Multi-domain (every domain reads this schema).

Hard gates:

- Data model / migration.

## Work Phases

1. Discovery — confirm schema vs. `data-model.md`.
2. Design — Drizzle table definitions + enums + indexes.
3. Validation planning — migration apply test on a Neon branch; invariant tests.
4. Implementation — schema + migrations + seed.
5. Verification — run migration on a Neon branch; assert unique-index + indexes exist.
6. Harness update — set story `--verify` once a test command exists.

## Stop Conditions

Pause for human confirmation if:

- The schema must diverge from SPEC §3 (e.g. new tables/columns).
- A destructive/irreversible migration is required.
- The one-OPEN-order-per-table invariant cannot be expressed as a partial unique index.
