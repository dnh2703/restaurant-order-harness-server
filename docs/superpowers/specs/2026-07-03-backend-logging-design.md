# Backend Logging & Observability — Design

**Date:** 2026-07-03
**Status:** Approved (design)
**Intake type:** Change request (fixing/refining accepted behavior)

## Problem

The server is effectively blind on the backend:

- Unhandled 500-level errors are logged **only outside production**
  (`src/presentation/http/plugins/error-handler.ts:34` —
  `if (!env.isProduction) console.error('[unhandled]', error)`). In production,
  the exact errors we most need to see are silently swallowed.
- There is **no request/access logging anywhere**. We cannot see which endpoints
  are called, their status codes, or their latency, in any environment.

Result: when something goes wrong on the BE side, there is no signal to diagnose it.

## Goal

Structured, readable logging that works in every environment:

- Request/response access logs (method, path, status, duration, request id).
- Unhandled errors logged server-side in **all** environments, correlated by
  request id, without leaking internal error text in HTTP responses.
- Colorized, easy-to-read output in development; machine-parseable JSON in
  production.

## Approach

Use **pino** directly (no third-party Elysia logging plugin — the community
`@bogeychan/elysia-logger` bridge is unmaintained, ~10 months stale). Wire pino
into Elysia with the framework's own lifecycle hooks. This keeps dependencies to
two well-maintained packages (`pino`, `pino-pretty`) and gives us full control
over a ~30-line request-logger plugin we own.

### Alternatives considered

- **In-house hand-rolled logger (no deps):** rejected — reimplements pino's
  level filtering, redaction, and serialization for no benefit; the user wants
  pino specifically.
- **`@bogeychan/elysia-logger` (pino-based Elysia plugin):** rejected —
  unmaintained (~10 months), adds a staleness risk for a thin wrapper we can
  write ourselves.
- **Minimal fix only (just unblock error logging):** rejected — leaves us with
  zero request visibility.

## Components

### 1. Logger core — `src/infrastructure/logging/logger.ts`

A single configured pino instance, exported for the whole app.

- **Development:** pino piped through **pino-pretty as a direct stream**
  (`pino(pretty({ colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' }))`).
  A stream (not pino's `transport` option) is used deliberately: `transport`
  spawns a worker thread, which has historically been unreliable under Bun. A
  synchronous stream avoids that entirely. Output is colorized and human-readable.
- **Production:** plain pino → JSON lines to stdout (one object per line),
  parseable by any host's log stream.
- **Level:** from `LOG_LEVEL` env var; default `debug` in development, `info` in
  production.
- **Redaction:** `redact` configured for authorization headers / token fields so
  bearer tokens and secrets never reach the logs.

### 2. Request logger plugin — `src/presentation/http/plugins/request-logger.ts`

A small Elysia plugin using native lifecycle hooks (no third-party plugin):

- `.derive()` attaches a per-request `requestId` (`crypto.randomUUID()`) and a
  start timestamp to the request context.
- `.onAfterResponse()` logs one line per request: `method`, `path`, `status`,
  `durationMs`, `requestId`.
- Log level by outcome: `5xx → error`, `4xx → warn`, otherwise `info`.
  `GET /api/health` is demoted to `debug` to avoid liveness-probe spam.
- Never logs the `Authorization` header, tokens, or request bodies (they carry
  PINs/JWTs). May log the authenticated `userId`/`role`/`restaurantId` for
  correlation when present — no secrets.

### 3. Error handler fix — `src/presentation/http/plugins/error-handler.ts`

- The `default` (500 / `INTERNAL_ERROR`) branch logs the **full error
  server-side in all environments**, including production, via the pino logger,
  correlated with the `requestId`.
- The HTTP **response body** still hides internal error messages in production
  (unchanged — this is a security property). Only the server-side log gains the
  detail.
- Errors carry the `requestId` so an access-log line and its error line can be
  correlated.

### 4. Wiring

- Mount the request-logger plugin first in `src/presentation/http/app.ts` so it
  wraps every route.
- Replace the raw `console.*` calls in `src/index.ts` (startup banner, shutdown
  errors) with the logger.

### 5. Config

- Add `logLevel` to `src/infrastructure/config/env.ts` (read once, validated like
  the other values; default `debug` in dev / `info` in prod).
- Document `LOG_LEVEL` in `.env.example`.

## Data flow

```
request
  → request-logger .derive()   (assign requestId + startTime)
  → route handler
      └─ on throw → error-handler (logs 500s w/ requestId, all envs)
  → request-logger .onAfterResponse()  (access log: method/path/status/durationMs/requestId)
```

## Error handling & edge cases

- **Bun + pino transport:** avoided by using a pino-pretty stream instead of the
  `transport` worker-thread option.
- **Secret leakage:** pino `redact` + explicit exclusion of Authorization/bodies
  in the request logger.
- **Health-check noise:** `GET /api/health` logged at `debug`.
- **Response-body safety:** production responses continue to omit internal error
  text; only logs gain detail.

## Testing (`bun test`)

- **Unit (logger):** level filtering honors `LOG_LEVEL`; redaction removes
  authorization/token fields; JSON shape in production mode.
- **Integration (via `app.handle(...)`):**
  - A normal request emits one access-log line containing `status`,
    `durationMs`, and `requestId`.
  - A forced 500 is logged server-side even when `NODE_ENV=production`, while the
    response body omits the internal message.

## New dependencies

- `pino` (^9)
- `pino-pretty` (^13)

No `@bogeychan/elysia-logger`.

## Out of scope (YAGNI)

- Log shipping / external aggregation (Datadog, Loki, etc.).
- Metrics/tracing (OpenTelemetry).
- Log-file rotation on disk (host captures stdout).
