# Validation — US-012 Temporary Sold-Out Toggle

## Proof Strategy

The kitchen can flip availability for its own dishes only; the change persists and is observable
through the customer menu read; another restaurant's dish cannot be touched.

## Test Plan

| Layer | Cases |
| --- | --- |
| Integration | toggle off then on persists `is_available`; cross-restaurant item → 404 MENU_ITEM_NOT_FOUND; route RBAC (KITCHEN ok, CASHIER 403, no token 401) |
| E2E | kitchen marks a dish sold out → customer menu read (US-006) shows it unavailable |
| Platform | runs against a Neon test branch |

## Fixtures

Per-suite restaurant → category → menu item, plus a second restaurant for the cross-tenant case.

## Commands

```text
bun test test/kitchen     # E07 kitchen suite
bun test                  # full suite (regression)
bun run typecheck && bun run lint && bun run format:check
```

Registered:
`scripts/bin/harness-cli story update --id US-012 --verify "bun test test/kitchen"` and
`--unit 0 --integration 1 --e2e 1 --platform 1`.

## Acceptance Evidence

Verified against the Neon test branch 2026-06-28.

- `test/kitchen/kitchen-availability.integration.test.ts` — toggle off returns
  `{ id, isAvailable:false }` and persists; toggle back on; cross-restaurant → MENU_ITEM_NOT_FOUND.
- `test/kitchen/kitchen-routes.integration.test.ts` — `PATCH /kitchen/menu-items/:id/availability`
  for a KITCHEN token returns `isAvailable:false`; CASHIER → 403; no token → 401.
- The US-006 menu read already filters/dims on `is_available` (covered by `test/menu.test.ts` /
  `test/get-menu.test.ts`), closing the customer-facing E2E.
- Full suite `bun test` → **125 pass / 0 fail** across 29 files. `typecheck`, `lint`,
  `format:check` clean.
