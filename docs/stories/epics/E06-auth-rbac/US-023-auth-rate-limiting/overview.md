# Overview — US-023 Rate limiting for authentication and expensive endpoints

## Status

planned

## Current Behavior

There is no rate limiting, throttling, lockout, or attempt counter anywhere in the
codebase. `POST /api/auth/login` (`src/presentation/http/routes/auth.ts:35`) accepts
unlimited attempts; argon2id slows each guess but nothing caps volume or locks an account.
The unauthenticated QR endpoints and the ADMIN image-upload endpoint (each upload buffers
up to 5 MB and performs an R2 write) are equally unthrottled.

## Target Behavior

- `POST /api/auth/login` is throttled per client IP **and** per target account; exceeding
  the limit returns `429 TOO_MANY_REQUESTS` with a retry hint, without leaking whether the
  account exists.
- A sensible global limiter covers the remaining unauthenticated / expensive routes (QR
  scan/read, image upload).
- Legitimate bursts (a busy kitchen re-authenticating, many diners scanning at once) are
  not blocked under normal operation — limits are tuned, not punitive.

## Affected Users

- Attackers — online password brute-force and endpoint abuse are bounded.
- Staff — a mistyped-password streak may hit the limit; the error must be clear and
  time-bounded.
- Customers — QR scans must stay under any global limit during normal table turnover.

## Affected Product Docs

- `docs/product/auth-authorization.md`
- `docs/product/api-conventions.md` (new `429` error code in the envelope)
- `docs/decisions/0023-auth-hardening-baseline.md`

## Non-Goals

- CAPTCHA or MFA.
- Distributed/shared rate-limit store across many instances (single-instance in-memory is
  the baseline; a shared store is a documented future option).
- Per-role quota or billing-style limits.
