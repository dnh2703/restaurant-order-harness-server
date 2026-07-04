# Exec Plan — US-022 Fail-fast on missing JWT secret outside tests

## Goal

Make it impossible for a running (non-test) service to sign or verify tokens with the
known in-repo dev secret. Missing `AUTH_JWT_SECRET` outside tests must stop startup.

## Scope

In scope:

- Change `authJwtSecret()` in `src/infrastructure/config/env.ts` so the dev fallback is
  gated on `NODE_ENV === 'test'` rather than "not production".
- Fail fast with a clear error when `AUTH_JWT_SECRET` is absent/empty outside tests.
- Update `.env.example` and `docs/product/auth-authorization.md` to state the requirement.

Out of scope:

- Rate limiting (US-023).
- Any change to token algorithm, TTLs, or refresh-token handling.
- Secret rotation / external secret managers.

## Risk Classification

Risk flags:

- Auth (JWT signing secret).
- Existing behavior (changes env-validation behavior; could break a deploy that relied on
  the fallback).
- Public contracts (indirect: a misconfigured deploy now returns startup failure instead of
  booting).

Hard gates:

- Auth.

## Work Phases

1. Discovery — confirm every consumer of `env.authJwtSecret` (access-token sign + verify).
2. Design — decide the exact guard (`NODE_ENV === 'test'` fallback) and error message.
3. Validation planning — unit tests over `authJwtSecret()` for test/prod/staging/unset.
4. Implementation — smallest change in `env.ts`; refresh docs + `.env.example`.
5. Verification — `bun test`, typecheck, lint; boot smoke with/without the var.
6. Harness update — record proof via `harness-cli story update`.

## Stop Conditions

Pause for human confirmation if:

- Discovery shows a legitimate non-test, non-prod runtime that intentionally relies on the
  fallback (would need an explicit opt-in flag instead).
- Making the check fail-fast would break the existing test bootstrap (tests must still run
  without setting `AUTH_JWT_SECRET`).
