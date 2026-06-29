# Exec Plan — US-018 Cashier & Payment

## Goal

Ship the cashier close-out half of the dining loop (SPEC EPIC 5) — open-tables list, bill detail,
discount, and finalize-payment — so an order can be billed, discounted, paid, and closed, freeing
its table. Money-safe by construction (no double-charge, server-authoritative amount).

## Scope

In scope:

- `GET /cashier/tables`, `GET /cashier/orders/:id`, `PATCH /cashier/orders/:id/discount`,
  `POST /cashier/orders/:id/payment`, guarded `['CASHIER','ADMIN']`.
- Error codes `ORDER_NOT_FOUND`, `ORDER_NOT_OPEN`, `INVALID_DISCOUNT`.

Out of scope:

- Bill-requested badge, surcharge, cash-tendered/change, invoice render, split/partial/refund,
  cashier realtime (see overview Non-Goals).

## Risk Classification

Risk flags:

- **Money.** Payment finalization records an irreversible charge and closes a session.
- **Concurrency.** Double-submit must not produce two payments.

Hard gates:

- Atomic OPEN→PAID conditional UPDATE is the only path that mints a payment.
- `payments.amount` derives from the gate's RETURNING `total`, never from the client.
- No schema/migration change.
- Money/concurrency assertions proven against a live migrated DB (not a self-skipped run).

## Work Phases

1. Discovery — confirmed schema, orders read-model, kitchen gate pattern, test harness.
2. Design — `docs/superpowers/specs/2026-06-29-us-018-cashier-payment-design.md`.
3. Validation planning — see `validation.md`.
4. Implementation — 3 TDD tasks (read surface → discount → checkout), subagent-driven.
5. Verification — per-task reviews + final whole-branch review (opus): Ready to merge.
6. Harness update — none (reuses authGuard, error-catalog, gate pattern, loadOrder).

## Stop Conditions

Pause for human confirmation if:

- Payment behavior is ambiguous (amount source, item-status gating).
- A schema migration or transaction wrapper becomes necessary.
- Validation requirements need weakening (e.g. skipping the double-checkout proof).

## Outcome

Complete. Branch `feat/us-018-cashier-payment`, HEAD `6f32ce9`, full suite 204/204. Final review:
Ready to merge — Yes. Deferred minors recorded in `validation.md` and the SDD ledger.
