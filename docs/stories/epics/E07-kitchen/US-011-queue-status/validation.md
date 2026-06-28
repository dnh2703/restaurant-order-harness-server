# Validation — US-011 Kitchen Queue & Status Transition

## Proof Strategy

The kitchen sees exactly the items it should (PENDING+COOKING, its restaurant only, oldest
first) and can only move them forward; illegal and cross-tenant moves are rejected; status
changes propagate over realtime.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | forward-only transition matrix: allow PENDING→COOKING, COOKING→SERVED; reject skip/backward/terminal/from-cancelled with INVALID_TRANSITION |
| Integration | queue returns only PENDING+COOKING, oldest first, with table name + options; SERVED/CANCELLED excluded; advance persists; illegal jump → 409; cross-restaurant item → 404; route RBAC (KITCHEN ok, CASHIER 403, no token 401) |
| E2E | item submitted → appears in queue → cook advances PENDING→COOKING→SERVED |
| Platform | runs against a Neon test branch |

## Fixtures

Per-suite restaurant → category → menu item → table → OPEN order, with order_items inserted at
known statuses. A second restaurant for the cross-tenant case. KITCHEN + CASHIER tokens minted
via `signAccessToken`.

## Commands

```text
bun test test/kitchen     # E07 kitchen suite
bun test                  # full suite (regression)
bun run typecheck && bun run lint && bun run format:check
```

Registered:
`scripts/bin/harness-cli story update --id US-011 --verify "bun test test/kitchen"` and
`--unit 1 --integration 1 --e2e 1 --platform 1`.

## Acceptance Evidence

Verified against the Neon test branch 2026-06-28.

- `test/kitchen/item-status.test.ts` — 8 unit assertions on the transition matrix.
- `test/kitchen/kitchen-status.integration.test.ts` — advance PENDING→COOKING persists; illegal
  jump → INVALID_TRANSITION; cross-restaurant + unknown id → NOT_FOUND.
- `test/kitchen/kitchen-queue.integration.test.ts` — only PENDING+COOKING, oldest first, table
  name + options present; empty restaurant → `[]`.
- `test/kitchen/kitchen-routes.integration.test.ts` — KITCHEN reads queue; CASHIER → 403; PATCH
  advances + 409 on illegal jump; no token → 401.
- Full suite `bun test` → **125 pass / 0 fail** across 29 files. `typecheck`, `lint`,
  `format:check` clean.
