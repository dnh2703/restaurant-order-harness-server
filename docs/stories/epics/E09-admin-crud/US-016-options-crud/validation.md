# Validation — US-016 Admin Options CRUD

## Proof Status

`scripts/bin/harness-cli story update --id US-016 --unit 1 --integration 1 --e2e 0 --platform 0`

| Layer | Proof |
| --- | --- |
| Unit | `test/option-groups/option-group-view.test.ts` — view mappers (4 tests: `toOptionView` maps an option row; preserves a negative `priceDelta`; `toOptionGroupView` maps a group with its nested options; yields an empty options array when the group has none). |
| Integration | `test/option-groups/option-group-use-cases.test.ts` (use-case behavior incl. create defaults, update with minProperties guard, delete cascades group→options, negative priceDelta allowed, cross-tenant 404s) and `test/option-groups/option-groups-routes.integration.test.ts` (HTTP nested CRUD, RBAC 403/401, invalid type 400, cross-tenant MENU_ITEM_NOT_FOUND + OPTION_GROUP_NOT_FOUND). Live Neon DB was reachable — DB suite ran rather than self-skipping. |
| E2E | Deferred — covered indirectly: customer menu read (US-006) already proven; admin-created groups and options surface on next read under the right menu item. |
| Platform | n/a |

## Evidence

- `bun test` — 178 pass, 0 fail across 38 files (option-groups suite: 22 pass, 0 fail across 3 files).
- `bun run typecheck`, `bun run lint` — clean.
