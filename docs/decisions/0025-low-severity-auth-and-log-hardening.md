# 0025 Low-severity auth & log-content hardening — timing-safe login, sanitized error logs

Date: 2026-07-11

## Status

Accepted

## Context

The 2026-07-04 security audit's read-only findings included five LOW-severity items. Three
are ordinary validation/config hardening with no hard gate (tracked directly as stories,
below, without a decision). Two land on FEATURE_INTAKE hard gates and warrant a durable
decision:

1. **Login timing enumeration.** `loginUseCase` (`src/application/auth/login.ts:33-40`)
   short-circuits at `!user` before calling `verifyPassword`, so an unknown email returns in
   roughly DB-lookup time while a known email with a wrong password pays the full argon2id
   verify cost. The response body is identical (`INVALID_CREDENTIALS`) either way, but the
   measurable timing difference lets an attacker enumerate valid staff emails without any
   valid credentials. Touches the **Auth** hard gate.
2. **Error-object logging.** The shared pino `err` serializer (`stdSerializers.err`,
   configured once in `src/infrastructure/logging/logger.ts`'s `baseOptions()` and used by
   all three `log.error({ err }, ...)` call sites: `error-handler.ts`, `dish-image-storage.ts`,
   `index.ts`) spreads every enumerable property of a thrown `Error` into log output. Driver
   errors from `pg` (constraint violations, etc.) carry `detail`/`hint`/`table`/`column`/query
   context, and `detail` in particular often echoes back the offending user-submitted value
   (e.g. `Key (email)=(user@example.com) already exists.`), landing unredacted in application
   logs. This is the same category of finding as decision 0024's qrToken-masking fix — touches
   the **Audit/security** hard gate.

## Decision

1. **Always invoke `verifyPassword` in `loginUseCase`**, against the real stored hash when the
   user exists or a fixed, module-level dummy hash when it doesn't, before branching on the
   result. Response body/status stay identical for every failure mode; only the timing
   difference closes. Tracked as **US-028**.
2. **Replace the shared pino `err` serializer with a fixed-field version** (`type`, `message`,
   `stack` only) in `logger.ts`'s `baseOptions()`, so every current and future
   `log.error({ err }, ...)` call site is safe by default with no per-call-site allowlist to
   maintain. Tracked as **US-030**.

## Alternatives Considered

1. (US-028) Add random delay/jitter to the fast-fail path — rejected; unreliable against
   statistical timing analysis over many requests, and adds latency to a legitimate flow too.
2. (US-028) Rely on US-023 rate limiting alone to make enumeration impractical — rejected;
   rate limiting bounds attempt volume but not a slow, low-and-slow enumeration over time, and
   the audit flagged this as a distinct, directly closeable gap.
3. (US-030) Redact specific known-risky sub-fields (`err.detail`, `err.hint`, ...) via pino's
   `redact.paths` — rejected; allowlist-by-exclusion, and every new error source (pg today,
   anything else tomorrow) needs its own reactive redact path.
4. (US-030) Fix only the `error-handler.ts` call site — rejected once discovery showed the
   `err` serializer is shared across three call sites; fixing it once in `logger.ts` covers all
   of them and forecloses the same leak in any future call site.

## Consequences

Positive:

- Staff email enumeration via login response timing is closed.
- Unhandled-error and storage-error logs can no longer leak user-submitted or schema-internal
  values through an error object's extra properties.

Tradeoffs:

- Login does one extra argon2id verify per unknown-email attempt — negligible cost, and
  attempt volume is already bounded by US-023 rate limiting.
- Production error logs lose driver-specific debug fields (pg `detail`/`hint`/`table`/
  `column`/query context); deep DB-error debugging now needs local reproduction instead of
  reading prod logs.

## Follow-Up

- Implement US-028 and US-030 (independent, either order).
- The three non-hard-gate LOW findings — `imageUrl` accepting any string, Postgres TLS not
  enforced in code, and dish-image bucket `Content-Disposition` — are tracked as **US-026**,
  **US-027**, and **US-029** without a decision record (ordinary validation/config hardening,
  no hard gate touched).
- Correction to decision 0024's follow-up: dish-image `Content-Disposition` turns out to be
  code-owned (Bun's `S3Client.write()` accepts a `contentDisposition` option), not out-of-repo
  config as previously noted. Only `X-Content-Type-Options: nosniff` on the served response
  genuinely requires Cloudflare/R2-edge configuration outside this repo. See US-029.
