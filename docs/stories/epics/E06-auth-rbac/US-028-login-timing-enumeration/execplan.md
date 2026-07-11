# Exec Plan — US-028 Close login timing enumeration

## Goal

Make login response latency (practically) indistinguishable between "unknown email" and
"known email, wrong password," without changing the response body/status contract.

## Scope

In scope:

- Change `loginUseCase` (`src/application/auth/login.ts`) so `verifyPassword` runs on every
  attempt, against the real hash or a fixed dummy hash.
- Add the dummy-hash constant (module-level, computed once).

Out of scope:

- Rate limiting / lockouts (already US-023).
- Password policy, hashing algorithm/cost changes.
- Any other enumeration surface (none currently exist in this codebase).

## Risk Classification

Risk flags:

- Auth (login credential-verification path).

Hard gates:

- Auth.

## Work Phases

1. Discovery — confirm `verifyPassword`'s contract (never throws, returns boolean) and that
   no other code path depends on `loginUseCase` skipping the verify for unknown emails.
2. Design — dummy-hash constant shape (see design.md).
3. Validation planning — unit tests asserting `verifyPassword` is invoked on every branch
   (unknown email, inactive user, wrong password); timing is not asserted in CI (wall-clock
   assertions are flaky) — this is a structural proof, not a benchmark.
4. Implementation — smallest change in `login.ts`.
5. Verification — `bun test`, typecheck, lint.
6. Harness update — record proof via `harness-cli story update`.

## Stop Conditions

Pause for human confirmation if:

- Discovery finds a caller that relies on `loginUseCase` *not* calling `verifyPassword` for
  unknown emails (e.g. a metric or short-circuit elsewhere) — none expected.
