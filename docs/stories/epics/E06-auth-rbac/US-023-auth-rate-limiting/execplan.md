# Exec Plan — US-023 Rate limiting for authentication and expensive endpoints

## Goal

Bound online brute-force against login and abuse/DoS of unauthenticated and expensive
endpoints, without blocking legitimate traffic.

## Scope

In scope:

- Per-IP + per-account throttle on `POST /api/auth/login`, returning `429`.
- A global limiter (per-IP) covering QR read/scan and image upload.
- A new `TOO_MANY_REQUESTS` (429) entry in the error catalog + api-conventions doc.
- Tuning defaults (window, max attempts) via config with safe fallbacks.

Out of scope:

- Distributed/shared store (Redis) — single-instance in-memory baseline; note the
  limitation and the upgrade path.
- CAPTCHA/MFA, account-lockout emails.
- Edge/proxy rate limits (complementary, configured outside the app).

## Risk Classification

Risk flags:

- Auth (login brute-force surface).
- Audit/security (throttling / abuse protection).
- Public contracts (new `429` response + envelope; client-visible behavior change).
- Existing behavior (login route response set gains `429`).
- External systems (indirect: protects the R2 upload path).

Hard gates:

- Auth.
- Audit/security.

## Work Phases

1. Discovery — pick the mechanism: an Elysia rate-limit plugin vs a small in-house
   middleware; confirm how to derive the real client IP behind the deploy's proxy.
2. Design — key strategy (IP, account, or both), window/limits, store, 429 envelope,
   non-enumerating error text; settle in `design.md`.
3. Validation planning — tests for under-limit pass, over-limit 429, window reset, and
   per-account vs per-IP isolation.
4. Implementation — smallest vertical slice: login first, then global limiter.
5. Verification — `bun test`, typecheck, lint; manual burst check.
6. Harness update — record proof; add the `429` code to api-conventions.

## Stop Conditions

Pause for human confirmation if:

- The correct client IP cannot be derived reliably behind the chosen deploy proxy (limits
  could be global or trivially bypassed).
- Chosen limits risk blocking a realistic legitimate burst (needs a product call on
  thresholds).
- A shared store turns out to be required for the target deployment topology (scope grows).
