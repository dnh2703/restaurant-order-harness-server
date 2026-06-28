# Validation — US-015 Admin Menu-Items CRUD

## Proof Status

`scripts/bin/harness-cli story update --id US-015 --unit 1 --integration 1 --e2e 0 --platform 0`

| Layer | Proof |
| --- | --- |
| Unit | `test/menu-items/menu-item-view.test.ts` — view mapping (2 tests: maps a row to admin-facing view; preserves null description and imageUrl). |
| Integration | `test/menu-items/menu-item-use-cases.test.ts` (use-case behavior incl. create defaults, optional categoryId filter, tenant 404, delete-in-use guard, move, partial patch) and `test/menu-items/menu-items-routes.integration.test.ts` (HTTP CRUD, RBAC 403/401, cross-tenant 404, MENU_ITEM_IN_USE 409, delete cascade). Live Neon DB was reachable — DB suite ran rather than self-skipping. |
| E2E | Deferred — covered indirectly: customer menu read (US-006) already proven; admin-created item surfaces on next read under the right category. |
| Platform | n/a |

## Evidence

- `bun test` — 156 pass, 0 fail across 35 files (menu-items suite: 18 pass, 0 fail across 3 files).
- `bun run typecheck`, `bun run lint` — clean.
