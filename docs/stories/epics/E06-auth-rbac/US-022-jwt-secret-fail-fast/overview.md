# Overview — US-022 Fail-fast on missing JWT secret outside tests

## Status

planned

## Current Behavior

`authJwtSecret()` (`src/infrastructure/config/env.ts:75-78`) returns a hardcoded, in-repo
secret `'dev-insecure-jwt-secret-change-me'` unless `NODE_ENV === 'production'`. The only
thing standing between a deployment and forgeable tokens is that exact string. If `NODE_ENV`
is unset, `staging`, `prod` (typo), or anything other than `production`, every access token
is signed and verified with a publicly-known secret.

## Target Behavior

The known dev fallback secret is used **only** when `NODE_ENV === 'test'`. In every other
environment `AUTH_JWT_SECRET` is required and the process fails fast at startup (clear error)
if it is missing or empty. Production behavior is unchanged (it already required the secret);
the change closes staging / unset / typo'd `NODE_ENV`.

## Affected Users

- All staff (`ADMIN`, `KITCHEN`, `CASHIER`) — their tokens can no longer be forged in a
  misconfigured non-prod deploy.
- Operators / deployers — must set `AUTH_JWT_SECRET` in every non-test environment.

## Affected Product Docs

- `docs/product/auth-authorization.md`
- `docs/decisions/0023-auth-hardening-baseline.md`

## Non-Goals

- Rotating or changing the signing algorithm (still HS256).
- Secret storage/rotation mechanics (KMS, vault) — out of scope.
- Rate limiting — separate story US-023.
