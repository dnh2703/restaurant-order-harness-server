# Validation — US-010 Staff Account & Role Administration

## Proof Strategy

An admin can fully manage staff within their restaurant and only their restaurant;
deactivation immediately ends the user's ability to refresh; secrets never leak in
responses or logs.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | create validation (email/role); password hashed on create; deactivate produces revoke side effect; response omits `password_hash` |
| Integration | CRUD persists; duplicate email → 409; admin of restaurant A cannot read/update restaurant B's user (404, no leakage); deactivating a user revokes their refresh tokens (subsequent refresh → 401) |
| E2E | admin creates a cashier, the cashier logs in, admin deactivates them, the cashier can no longer refresh/log in |
| Platform | runs against a Neon test branch |
| Performance | n/a |
| Logs/Audit | privileged actions logged without secrets |

## Fixtures

From the US-002 seed: one `ADMIN` in restaurant A, one `ADMIN` in restaurant B, plus a
`CASHIER` in restaurant A to manage. Known passwords for login assertions.

## Commands

```text
bun test test/staff      # US-010 staff suite (unit + integration/e2e)
bun test                 # full suite (regression)
bun run typecheck && bun run lint && bun run format
```

Registered:
`scripts/bin/harness-cli story update --id US-010 --verify "bun test test/staff"` and
`scripts/bin/harness-cli story update --id US-010 --unit 1 --integration 1 --e2e 1 --platform 1`.

## Acceptance Evidence

Verified against the Neon test branch (platform).

- `bun test test/staff` → **12 pass / 0 fail** (2 files): `staff-view` unit + `staff-admin`
  integration/e2e.
- Full suite `bun test` → **99 pass / 0 fail** across 23 files. `typecheck`, `lint`,
  `format` all clean.

Key proofs (all in `test/staff/staff-admin.integration.test.ts`):

- **Tenant scope** — `GET /api/staff` returns only restaurant A's users; restaurant B's
  user never appears. Cross-restaurant `PATCH /api/staff/:id` → `404 USER_NOT_FOUND`
  (no leakage).
- **Create** — `POST /api/staff` → `201`, password stored hashed (not plaintext), response
  omits `passwordHash`, and the created credentials log in successfully. Duplicate email →
  `409 EMAIL_TAKEN`.
- **RBAC** — non-admin (`CASHIER`) → `403 FORBIDDEN`; missing token → `401 UNAUTHORIZED`.
- **Deactivation (E2E)** — admin creates a cashier, the cashier logs in, admin sets
  `isActive=false`; the cashier's refresh token is rejected (`401`) and the cashier can no
  longer log in (`401`).
- **Last-admin protection** (decision 0011) — demoting or deactivating the only active
  admin → `409 LAST_ADMIN`; demotion succeeds once a second active admin exists.
