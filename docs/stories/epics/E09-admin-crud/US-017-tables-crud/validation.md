# Validation — US-017 Admin Tables CRUD + QR Token

## Proof Status

`scripts/bin/harness-cli story update --id US-017 --unit 1 --integration 1 --e2e 0 --platform 0`

| Layer | Proof |
| --- | --- |
| Unit | `test/tables/table-view.test.ts` — view mappers (2 tests: `toTableView` maps a row to the admin-facing view; preserves a null `capacity` and an `OCCUPIED` status). |
| Integration | `test/tables/table-use-cases.test.ts` (use-case behavior incl. create mints a non-empty `qrToken` and defaults `status=EMPTY`, update patches only sent fields and 404s a cross-tenant id, empty-patch returns the unchanged row, regenerate replaces the token, delete removes an empty table but refuses one with an `OPEN` order via `409 TABLE_IN_USE`) and `test/tables/tables-routes.integration.test.ts` (HTTP CRUD, RBAC 403/401, status+qrToken stripped on create, regenerate-qr old-token→404/new-token→200, cross-tenant `TABLE_NOT_FOUND` on PATCH/DELETE/regenerate, empty-PATCH body→400, delete-with-OPEN-order→`409 TABLE_IN_USE`). Live Neon DB was reachable — DB suite ran rather than self-skipping. |
| E2E | Deferred — covered indirectly: admin creates a table → its `qrToken` resolves through the existing customer QR flow (`GET /api/qr/:qrToken`, US-005); regenerate invalidates the old token (proven in the integration suite). |
| Platform | n/a |

## Evidence

- `bun test` — 192 pass, 0 fail across 41 files (tables suite: 14 pass, 0 fail across 3 files).
- `bun run typecheck`, `bun run lint` — clean.
