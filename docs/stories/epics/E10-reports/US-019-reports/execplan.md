# Exec Plan — US-019 Reports

## Goal

Ship the admin reporting surface (SPEC EPIC 7) — daily revenue by date range and top-selling dishes
— over the existing `payments`/`orders`/`order_items` data, so an `ADMIN` can see revenue and what
sells. Read-only, no schema change.

## Scope

In scope:

- `GET /reports/revenue`, `GET /reports/top-dishes`, guarded `['ADMIN']`.
- Error code `INVALID_DATE_RANGE`; pure `parseReportRange`; app-wide `APP_TZ`.

Out of scope:

- CSV export, zero-filled series, per-restaurant timezone, option-delta revenue attribution,
  indexes/migration, charts/pagination/non-daily groupings (see overview Non-Goals).

## Risk Classification

Risk flags:

- **Normal.** Read-only aggregations; no money mutation, no schema change, no concurrency.

Hard gates:

- Revenue derives from `payments.amount`, never the client or `orders.total`.
- Tenancy always via the `orders.restaurant_id` join from `auth.restaurantId`.
- No schema/migration change.
- Aggregation correctness proven against a live migrated DB (not a self-skipped run).

## Work Phases

1. Discovery — confirmed schema (`payments`/`orders`/`order_items`), cashier route pattern, test harness.
2. Design — `docs/superpowers/specs/2026-06-29-us-019-reports-design.md`.
3. Validation planning — see `validation.md`.
4. Implementation — 3 TDD tasks (date-range foundation → revenue → top-dishes), subagent-driven.
5. Verification — per-task reviews + final whole-branch review.
6. Harness update — none (reuses authGuard, error-catalog, the cashier slice patterns).

## Stop Conditions

Pause for human confirmation if:

- A schema migration or transaction wrapper becomes necessary.
- The timezone / revenue-source definition needs to change.
- Validation requirements need weakening (e.g. skipping the live-DB aggregation proof).

## Outcome

Complete. Branch `feat/us-019-reports`, HEAD `28bab70`. Reports suite 7/7 (DB ran); typecheck + lint
clean; no migration. A Task 3 grouping deviation and a final-review rename-stability test gap were
both caught and fixed. Final review: ready to merge. Deferred non-blocking minors recorded here and
in the SDD ledger.
