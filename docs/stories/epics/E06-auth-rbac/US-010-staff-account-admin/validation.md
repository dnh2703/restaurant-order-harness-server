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

Add after the toolchain exists, e.g.:

```text
bun test test/staff
```

Then register: `scripts/bin/harness-cli story update --id US-010 --verify "<test cmd>"`
and set proof booleans, e.g.
`scripts/bin/harness-cli story update --id US-010 --unit 1 --integration 1 --e2e 1 --platform 1`.

## Acceptance Evidence

Add after verification: passing test output, the cross-restaurant 404 proof, and the
post-deactivation refresh rejection.
