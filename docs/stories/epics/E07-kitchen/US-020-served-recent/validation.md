# Validation — US-020 Kitchen Served-Recent

## Proof Status

`scripts/bin/harness-cli story update --id US-020 --unit 0 --integration 1 --e2e 0 --platform 1`

| Layer | Proof |
| --- | --- |
| Unit | n/a — behavior is query/route integration over `served_at` and auth scope. |
| Integration | `test/kitchen/kitchen-served-recent.integration.test.ts` covers the recent window, newest-first sorting, tenant scoping, cap at 50, empty result, `served_at` stamping, option snapshots, and route auth. |
| E2E | Deferred — backend route proven; frontend kitchen panel is outside this server slice. |
| Platform | Migration/index plus Bun/Elysia route on the existing kitchen stack. |

## Evidence

- Merged in PR #16 (`feat/kitchen-served-recent`).
- `GET /api/kitchen/served-recent` returns `SERVED` items from the last 30 minutes,
  scoped to the token restaurant and capped at 50.
- `advanceItemStatus` leaves `served_at` null before `SERVED` and stamps it when
  advancing to `SERVED`.
- Route checks: KITCHEN token -> 200, CASHIER token -> 403, no token -> 401.
