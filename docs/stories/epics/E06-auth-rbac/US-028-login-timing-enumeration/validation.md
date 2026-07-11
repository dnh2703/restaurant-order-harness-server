# Validation — US-028 Close login timing enumeration

## Proof Strategy

Prove that `verifyPassword` is invoked on every login attempt regardless of whether the
account exists or is active, and that the observable error/response is unchanged. Timing
itself is a defense-in-depth improvement, not something asserted in CI — wall-clock
assertions in a shared CI runner are unreliable.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Mock/fake database returning: (a) no user, (b) an inactive user, (c) an active user with a wrong password. Assert `verifyPassword` is called in all three cases and each throws the same `INVALID_CREDENTIALS` `AppError`. Assert a correct password for an active user still succeeds. |
| Integration | `POST /api/auth/login` with an unknown email vs. a known email + wrong password: both return the same `401 INVALID_CREDENTIALS` body/shape (already covered by existing auth integration tests — confirm no regression). |
| E2E | Existing auth E2E (login → /me → refresh) still passes. |
| Platform | n/a |
| Performance | Not asserted in CI; optional local note if a manual timing comparison is run. |

## Fixtures

- Existing user fixtures from the auth test suite; no new fixtures needed.

## Commands

```text
bun test test/auth           # or the file(s) covering loginUseCase
bun test                     # full suite stays green
bun run typecheck && bun run lint
```

## Acceptance Evidence

Add results after verification.
