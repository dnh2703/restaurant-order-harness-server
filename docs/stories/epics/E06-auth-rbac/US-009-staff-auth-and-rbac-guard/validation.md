# Validation — US-009 Staff Auth & RBAC Guard

## Proof Strategy

The auth subsystem is correct and secure: passwords verify only against their hash,
access tokens are signed/verified with the right claims and expiry, refresh tokens are
revocable, and the guard blocks unauthenticated and wrong-role access while enforcing
tenant scope.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | argon2 hash + verify (wrong password fails); JWT sign/verify (tampered token fails; expired token rejected); refresh-token hashing; `requireRole` allow/deny; tenant-scope filter helper |
| Integration | login returns tokens + persists refresh row; refresh issues new access token; logout revokes; revoked/expired refresh → 401; `GET /api/auth/me` requires valid access token |
| E2E | staff logs in and reaches only the allowed area; another role / no token is blocked (403/401) |
| Platform | flow works against a Neon test branch; token expiry honored |
| Performance | argon2 params tuned (reasonable login latency, not trivially cheap) |
| Logs/Audit | auth events logged without secrets; no password/token/hash in logs |

## Fixtures

From the US-002 seed: one `ADMIN`, one `KITCHEN`, one `CASHIER` user with known
passwords and `is_active = true`; one inactive user to prove inactive login is rejected;
two restaurants to prove tenant isolation.

## Commands

```text
bun test test/auth        # unit + integration (self-skips without a migrated DATABASE_URL)
bun test                  # full suite
```

Registered: `harness-cli story update --id US-009 --verify "bun test test/auth"
--unit 1 --integration 1 --e2e 1 --platform 1`.

## Acceptance Evidence

Verified 2026-06-28 on the Neon test branch (`bun test`: **87 pass / 0 fail**, 21 files;
`typecheck` / `oxlint` / `prettier --check` clean). `test/auth/` = 27 tests / 6 files.

- **Unit** — `refresh-token` (opaque gen, deterministic SHA-256 hash, raw ≠ hash);
  `access-token` (JWT round-trip; tampered, wrong-secret, and expired tokens rejected);
  `password` (argon2id verify, wrong password fails); `auth-guard` (no/invalid token →
  401 `UNAUTHORIZED`, wrong role → 403 `FORBIDDEN`, right role → 200 with identity).
- **Integration (live Neon)** — login issues access + refresh and persists only the
  refresh **hash** (raw ≠ stored); wrong password / unknown email / inactive user all →
  401 `INVALID_CREDENTIALS`; `GET /me` requires a valid access token; refresh rotates
  (old token rejected, new accepted); replaying a rotated token → 401 `TOKEN_REVOKED` and
  the whole family is revoked; expired refresh → 401 `TOKEN_EXPIRED`; logout → 204 and is
  idempotent, after which the token can no longer refresh.
- **E2E / authorization** — the guard, driven end-to-end through `app.handle`, lets the
  correct role reach a role-restricted route and blocks a wrong role (403) and an
  unauthenticated request (401).
- **Platform** — all DB-backed proofs run against a migrated Neon branch with cold-start
  warm-up; access-token expiry honored.

Sample login response (tokens redacted):

```json
{ "data": { "accessToken": "<jwt>", "refreshToken": "<opaque>",
  "user": { "id": "…", "email": "admin@…", "name": "Admin", "role": "ADMIN",
            "restaurantId": "…" } } }
```

Rotation policy recorded in decision
[0010](../../../../decisions/0010-refresh-token-rotation.md).
