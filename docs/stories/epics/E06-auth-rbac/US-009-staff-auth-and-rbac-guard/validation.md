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

Add after the toolchain exists, e.g.:

```text
bun test test/auth        # unit + integration
```

Then register: `scripts/bin/harness-cli story update --id US-009 --verify "<test cmd>"`
and set proof booleans, e.g.
`scripts/bin/harness-cli story update --id US-009 --unit 1 --integration 1 --e2e 1 --platform 1`.

## Acceptance Evidence

Add after verification: passing test output, a sample login response (tokens redacted),
and proof that a revoked refresh token and a wrong-role request are rejected.
