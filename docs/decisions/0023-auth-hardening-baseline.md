# 0023 Auth Hardening Baseline — enforce prod JWT secret + rate-limit auth

Date: 2026-07-04

## Status

Accepted

## Context

A read-only security audit (2026-07-04) of the backend found the auth design solid
(HS256 with pinned verify algorithm, argon2id, hashed+rotated refresh tokens, tenant
scoping from the token) but surfaced two **HIGH** operational-hardening gaps that both
touch the Auth hard gate:

1. **Forgeable tokens outside production.** `authJwtSecret()`
   (`src/infrastructure/config/env.ts:75-78`) falls back to the hardcoded, in-repo secret
   `'dev-insecure-jwt-secret-change-me'` unless `NODE_ENV === 'production'` (an exact string
   compare). Any deployment where `NODE_ENV` is unset, `staging`, or a typo signs and
   verifies every access token with a publicly-known secret, letting anyone forge an ADMIN
   token for any `restaurantId` — full auth bypass and cross-tenant takeover.

2. **No rate limiting anywhere.** `POST /api/auth/login` has no attempt counter, lockout,
   or per-IP/per-account throttle, so staff passwords can be brute-forced online (argon2id
   slows each attempt but nothing caps volume). QR and upload endpoints are likewise
   unthrottled and abusable for DoS.

These are hardening changes to authentication behavior, so per FEATURE_INTAKE they enter
the high-risk lane and warrant a durable decision.

## Decision

1. **Require a strong JWT signing secret whenever the process is not running tests.**
   Replace the `NODE_ENV === 'production'`-only guard: `AUTH_JWT_SECRET` is mandatory (fail
   fast at startup) unless `NODE_ENV === 'test'`. The known dev fallback is only ever used
   under `bun test`. Tracked as **US-022**.

2. **Add rate limiting to authentication and other unauthenticated/expensive endpoints.**
   Per-IP + per-account throttling on `POST /api/auth/login` (primary), plus a sensible
   global limiter covering QR and upload routes. Exact store (in-memory vs shared) and
   limits are settled in the US-023 design. Tracked as **US-023**.

## Alternatives Considered

1. Keep the `production` string check and rely on deploy discipline to set `NODE_ENV` —
   rejected: a single missing/typo'd env var is a full auth bypass; the failure mode is too
   severe to leave to convention.
2. Rate-limit only at the reverse proxy / edge — reasonable and complementary, but leaves
   the app defenseless in any deploy without that edge (local, single-container, preview).
   Decision: implement in-app as the baseline; edge limits remain an allowed addition.
3. Do nothing / accept the risk — rejected for HIGH-severity auth findings.

## Consequences

Positive:

- A misconfigured `NODE_ENV` can no longer silently produce forgeable tokens; the service
  refuses to boot without a real secret outside tests.
- Online password brute-force and endpoint abuse are bounded.

Tradeoffs:

- Deploys must now set `AUTH_JWT_SECRET` explicitly (staging included) or the app fails
  fast — intended, but a migration note for existing environments.
- Rate limiting adds state (counter store) and a small per-request cost; limits need tuning
  to avoid blocking legitimate bursts (e.g. a busy kitchen re-authenticating).

## Follow-Up

- Implement US-022 then US-023 (US-022 is smaller and unblocks nothing, but both are
  independent).
- The MEDIUM audit findings (qrToken in access logs, OpenAPI docs public, security headers,
  global body-size limit, magic-byte file validation) are batched separately, not in this
  decision.
