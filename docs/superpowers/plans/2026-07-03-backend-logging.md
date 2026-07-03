# Backend Logging & Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the backend structured, colorized-in-dev / JSON-in-prod logging via pino — request access logs plus unhandled errors logged in every environment.

**Architecture:** A single pino instance (`src/infrastructure/logging/logger.ts`) is the one logger for the app. A small Elysia plugin we own (`request-logger.ts`) emits one access-log line per request using native lifecycle hooks. The global error handler is changed to log 500s in all environments (the current code only logs outside production). No third-party Elysia logging plugin is used.

**Tech Stack:** Bun ≥ 1.3, ElysiaJS 1.4, pino 9, pino-pretty 13, TypeScript, `bun test`.

## Global Constraints

- **Runtime:** Bun ≥ 1.3.0; ESM (`"type": "module"`). Use `import`/`export`, no `require`.
- **No pino `transport` worker threads** — attach pino-pretty as a direct stream instead (Bun reliability).
- **Never log secrets:** no `Authorization` header, no tokens, no request bodies in logs.
- **Response bodies unchanged:** production HTTP error responses still omit internal error text; only server-side logs gain detail.
- **New dependencies:** exactly `pino` and `pino-pretty`. Do **not** add `@bogeychan/elysia-logger`.
- **DB-free tests:** all new tests must be hermetic (no `DATABASE_URL`) — do not import `src/presentation/http/app.ts` (it pulls the DB); build minimal Elysia apps in-test.
- **Commit style:** conventional commits (`feat(logging): ...`), enforced by commitlint.

---

### Task 1: Logger core + config

**Files:**
- Create: `src/infrastructure/logging/logger.ts`
- Modify: `src/infrastructure/config/env.ts` (add `logLevel`)
- Modify: `.env.example` (document `LOG_LEVEL`)
- Test: `test/logging/logger.test.ts`

**Interfaces:**
- Consumes: `env` from `src/infrastructure/config/env.ts` (`env.isProduction`, new `env.logLevel`).
- Produces:
  - `baseOptions(): import('pino').LoggerOptions`
  - `createLogger(overrides?: { level?: string; stream?: import('pino').DestinationStream }): import('pino').Logger`
  - `logger: import('pino').Logger` (the shared default instance)

- [ ] **Step 1: Install dependencies**

Run:
```bash
bun add pino pino-pretty
```
Expected: `pino` and `pino-pretty` appear under `dependencies` in `package.json`.

- [ ] **Step 2: Add `logLevel` to env config**

In `src/infrastructure/config/env.ts`, add a helper above the `export const env` object (after the existing `authJwtSecret` function):

```ts
/**
 * Log verbosity for pino. Explicit LOG_LEVEL wins; otherwise default to a chatty
 * `debug` in development and a quieter `info` in production.
 */
function logLevel(): string {
  const raw = process.env.LOG_LEVEL?.trim()
  if (raw) return raw
  return isProduction ? 'info' : 'debug'
}
```

Then add this field to the `env` object (e.g. right after `isTest`):

```ts
  logLevel: logLevel(),
```

- [ ] **Step 3: Document `LOG_LEVEL` in `.env.example`**

Add under the `# Runtime` section of `.env.example` (after the `PORT=3000` line):

```
# Log verbosity: trace | debug | info | warn | error | fatal.
# Default: debug in development, info in production.
LOG_LEVEL=debug
```

- [ ] **Step 4: Write the failing test**

Create `test/logging/logger.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import { pino } from 'pino'

import { baseOptions, createLogger } from '../../src/infrastructure/logging/logger'

/**
 * Captures pino's newline-delimited JSON output into parsed objects so we can
 * assert on level filtering and redaction without touching stdout.
 */
function capture(): { stream: { write: (s: string) => void }; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = []
  const stream = {
    write: (s: string) => {
      lines.push(JSON.parse(s))
    },
  }
  return { stream, lines }
}

describe('logger core', () => {
  it('honors the configured level (drops below-threshold records)', () => {
    const { stream, lines } = capture()
    const log = createLogger({ level: 'warn', stream })

    log.debug('nope')
    log.info('nope')
    log.warn('yep')
    log.error('yep')

    // pino numeric levels: warn=40, error=50
    expect(lines.map((l) => l.level)).toEqual([40, 50])
  })

  it('redacts authorization headers', () => {
    const { stream, lines } = capture()
    const log = createLogger({ level: 'info', stream })

    log.info({ req: { headers: { authorization: 'Bearer super-secret' } } }, 'incoming')

    const record = lines[0] as { req: { headers: { authorization: string } } }
    expect(record.req.headers.authorization).toBe('[REDACTED]')
    expect(JSON.stringify(record)).not.toContain('super-secret')
  })

  it('serializes an `err` field into message + type', () => {
    const log = pino({ ...baseOptions(), level: 'error' }, ((): { write: (s: string) => void } => {
      return { write: () => {} }
    })())
    // Smoke: baseOptions must include an err serializer so error logging works.
    expect(baseOptions().serializers).toBeDefined()
    expect((baseOptions().serializers as Record<string, unknown>).err).toBeDefined()
    log.error({ err: new Error('boom') }, 'unhandled')
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run:
```bash
bun test test/logging/logger.test.ts
```
Expected: FAIL — cannot resolve `../../src/infrastructure/logging/logger`.

- [ ] **Step 6: Write the logger module**

Create `src/infrastructure/logging/logger.ts`:

```ts
import { pino, stdSerializers, type DestinationStream, type Logger, type LoggerOptions } from 'pino'
import pretty from 'pino-pretty'

import { env } from '../config/env'

/**
 * Shared pino configuration. Redaction is belt-and-suspenders: the request logger
 * never logs headers/bodies, but if a token ever reaches a log field it is censored.
 */
export function baseOptions(): LoggerOptions {
  return {
    level: env.logLevel,
    serializers: { err: stdSerializers.err },
    redact: {
      paths: ['req.headers.authorization', 'headers.authorization', 'authorization'],
      censor: '[REDACTED]',
    },
  }
}

/**
 * Development gets a colorized, human-readable stream (synchronous — no worker
 * thread, which keeps it reliable under Bun). Production returns undefined so pino
 * writes plain JSON lines to stdout.
 */
function defaultStream(): DestinationStream | undefined {
  if (env.isProduction) return undefined
  return pretty({ colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' })
}

export function createLogger(
  overrides: { level?: string; stream?: DestinationStream } = {},
): Logger {
  const opts: LoggerOptions = {
    ...baseOptions(),
    ...(overrides.level ? { level: overrides.level } : {}),
  }
  const dest = overrides.stream ?? defaultStream()
  return dest ? pino(opts, dest) : pino(opts)
}

/** The one logger the app shares. */
export const logger = createLogger()
```

- [ ] **Step 7: Run the test to verify it passes**

Run:
```bash
bun test test/logging/logger.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 8: Typecheck**

Run:
```bash
bun run typecheck
```
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add package.json bun.lock src/infrastructure/logging/logger.ts src/infrastructure/config/env.ts .env.example test/logging/logger.test.ts
git commit -m "feat(logging): add pino logger core and LOG_LEVEL config"
```

---

### Task 2: Request logger plugin

**Files:**
- Create: `src/presentation/http/plugins/request-logger.ts`
- Test: `test/logging/request-logger.test.ts`

**Interfaces:**
- Consumes: `logger` from `src/infrastructure/logging/logger.ts`.
- Produces: `requestLogger(log?: import('pino').Logger): Elysia` — an Elysia plugin that derives `requestId` + `startTime` globally and logs one access line per request in `onAfterResponse`.

- [ ] **Step 1: Write the failing test**

Create `test/logging/request-logger.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { pino, type Logger } from 'pino'

import { requestLogger } from '../../src/presentation/http/plugins/request-logger'

function capture(): { log: Logger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = []
  const log = pino({ level: 'debug' }, {
    write: (s: string) => {
      lines.push(JSON.parse(s))
    },
  })
  return { log, lines }
}

describe('request logger plugin', () => {
  it('logs one access line per request with method/path/status/durationMs/requestId', async () => {
    const { log, lines } = capture()
    const app = new Elysia().use(requestLogger(log)).get('/ping', () => 'pong')

    await app.handle(new Request('http://localhost/ping'))

    expect(lines).toHaveLength(1)
    const line = lines[0] as Record<string, unknown>
    expect(line.method).toBe('GET')
    expect(line.path).toBe('/ping')
    expect(line.status).toBe(200)
    expect(typeof line.durationMs).toBe('number')
    expect(typeof line.requestId).toBe('string')
    expect(line.level).toBe(30) // info
  })

  it('demotes /api/health to debug level', async () => {
    const { log, lines } = capture()
    const app = new Elysia().use(requestLogger(log)).get('/api/health', () => 'ok')

    await app.handle(new Request('http://localhost/api/health'))

    expect(lines[0]!.level).toBe(20) // debug
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
bun test test/logging/request-logger.test.ts
```
Expected: FAIL — cannot resolve `../../src/presentation/http/plugins/request-logger`.

- [ ] **Step 3: Write the plugin**

Create `src/presentation/http/plugins/request-logger.ts`:

```ts
import { randomUUID } from 'node:crypto'

import { Elysia } from 'elysia'
import type { Logger } from 'pino'

import { logger as defaultLogger } from '../../../infrastructure/logging/logger'

/**
 * Access logging via Elysia's own lifecycle hooks (no third-party plugin).
 * `derive` (global) tags every request with an id + start time so handlers and the
 * error handler can correlate; `onAfterResponse` emits exactly one line per request.
 *
 * The logger is injectable so tests can capture output; production uses the shared one.
 */
export function requestLogger(log: Logger = defaultLogger): Elysia {
  return new Elysia({ name: 'request-logger' })
    .derive({ as: 'global' }, () => ({
      requestId: randomUUID(),
      startTime: performance.now(),
    }))
    .onAfterResponse({ as: 'global' }, (ctx) => {
      const { request, set, path, requestId, startTime } = ctx as typeof ctx & {
        requestId: string
        startTime: number
      }
      const durationMs = Math.round(performance.now() - startTime)
      const status = typeof set.status === 'number' ? set.status : 200
      const method = request.method

      const level =
        status >= 500 ? 'error' : status >= 400 ? 'warn' : path === '/api/health' ? 'debug' : 'info'

      log[level]({ requestId, method, path, status, durationMs }, `${method} ${path} ${status}`)
    })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
bun test test/logging/request-logger.test.ts
```
Expected: PASS (2 tests). If `set.status` is not populated for the 200 case, the `?? 200` fallback covers it; the test asserts 200.

- [ ] **Step 5: Typecheck**

Run:
```bash
bun run typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/presentation/http/plugins/request-logger.ts test/logging/request-logger.test.ts
git commit -m "feat(logging): add request access-log plugin"
```

---

### Task 3: Log unhandled errors in all environments

**Files:**
- Modify: `src/presentation/http/plugins/error-handler.ts`
- Test: `test/logging/error-handler-logging.test.ts`

**Interfaces:**
- Consumes: `logger` from `src/infrastructure/logging/logger.ts`; `requestId` from the request-logger's global `derive`.
- Produces: change `errorHandler` from a const value into `errorHandler(log?: import('pino').Logger): Elysia`. (Task 4 updates the one caller in `app.ts`.)

- [ ] **Step 1: Write the failing test**

Create `test/logging/error-handler-logging.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { pino, type Logger } from 'pino'

import { errorHandler } from '../../src/presentation/http/plugins/error-handler'

function capture(): { log: Logger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = []
  const log = pino({ level: 'debug', serializers: { err: pino.stdSerializers.err } }, {
    write: (s: string) => {
      lines.push(JSON.parse(s))
    },
  })
  return { log, lines }
}

describe('error handler logging', () => {
  it('logs unhandled errors server-side and returns the INTERNAL_ERROR envelope', async () => {
    const { log, lines } = capture()
    const app = new Elysia().use(errorHandler(log)).get('/boom', () => {
      throw new Error('kaboom')
    })

    const res = await app.handle(new Request('http://localhost/boom'))

    // Logged server-side (this is the fix — previously suppressed in production).
    expect(lines).toHaveLength(1)
    const line = lines[0] as { level: number; err?: { message?: string } }
    expect(line.level).toBe(50) // error
    expect(line.err?.message).toBe('kaboom')

    // Response still uses the standard envelope with the mapped 500 status.
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('INTERNAL_ERROR')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
bun test test/logging/error-handler-logging.test.ts
```
Expected: FAIL — `errorHandler` is currently a value, not a function (`errorHandler is not a function`).

- [ ] **Step 3: Refactor the error handler**

Replace the full contents of `src/presentation/http/plugins/error-handler.ts` with:

```ts
import { Elysia } from 'elysia'
import type { Logger } from 'pino'

import { env } from '../../../infrastructure/config/env'
import { logger as defaultLogger } from '../../../infrastructure/logging/logger'
import { AppError, ERROR_CATALOG, errorEnvelope } from '../../../shared/errors'

/**
 * Maps thrown/validation errors to the project's error envelope:
 *   { "error": { "code", "message", "details"? } }
 * Codes, messages, and statuses come from the shared error catalog
 * (src/shared/errors). See docs/product/api-conventions.md.
 *
 * The logger is injectable for tests; production uses the shared pino instance.
 */
export function errorHandler(log: Logger = defaultLogger): Elysia {
  return new Elysia({ name: 'error-handler' }).onError({ as: 'global' }, (ctx) => {
    const { code, error, set } = ctx
    const requestId = (ctx as { requestId?: string }).requestId

    // Application/domain errors carry their own code + status.
    if (error instanceof AppError) {
      set.status = error.status
      return errorEnvelope(error.code, { message: error.message, details: error.details })
    }

    // Framework-level errors raised by Elysia.
    switch (code) {
      case 'VALIDATION':
        set.status = ERROR_CATALOG.VALIDATION_ERROR.status
        return errorEnvelope('VALIDATION_ERROR', { details: error.all })
      case 'NOT_FOUND':
        set.status = ERROR_CATALOG.NOT_FOUND.status
        return errorEnvelope('NOT_FOUND')
      case 'PARSE':
        set.status = ERROR_CATALOG.MALFORMED_REQUEST.status
        return errorEnvelope('MALFORMED_REQUEST')
      default: {
        set.status = ERROR_CATALOG.INTERNAL_ERROR.status
        // Log the real error server-side in EVERY environment (this is the fix —
        // previously suppressed in production, leaving prod 500s invisible).
        log.error({ err: error, requestId }, 'unhandled error')
        // Never leak internal error text in the response body in production.
        const message = !env.isProduction && error instanceof Error ? error.message : undefined
        return errorEnvelope('INTERNAL_ERROR', { message })
      }
    }
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
bun test test/logging/error-handler-logging.test.ts
```
Expected: PASS (1 test).

- [ ] **Step 5: Typecheck**

Run:
```bash
bun run typecheck
```
Expected: FAIL — `src/presentation/http/app.ts` still uses `errorHandler` as a value. This is fixed in Task 4. (If you are running tasks strictly independently, proceed to commit; the app-level typecheck is green after Task 4.)

- [ ] **Step 6: Commit**

```bash
git add src/presentation/http/plugins/error-handler.ts test/logging/error-handler-logging.test.ts
git commit -m "feat(logging): log unhandled errors in all environments"
```

---

### Task 4: Wire logging into the app and entrypoint

**Files:**
- Modify: `src/presentation/http/app.ts`
- Modify: `src/index.ts`
- Test: none new — verified by `bun run typecheck` and the full `bun test` logging suite.

**Interfaces:**
- Consumes: `requestLogger` (Task 2), `errorHandler` factory (Task 3), `logger` (Task 1).

- [ ] **Step 1: Mount the request logger and call the error-handler factory**

In `src/presentation/http/app.ts`:

Add imports (alongside the existing plugin imports):
```ts
import { requestLogger } from './plugins/request-logger'
```

Change the composition so `requestLogger` is first and `errorHandler` is called:
```ts
export const app = new Elysia({ prefix: '/api' })
  .use(requestLogger())
  .use(errorHandler())
  .use(openapiPlugin)
  // ...rest unchanged
```
(The existing `.use(errorHandler)` becomes `.use(errorHandler())`.)

- [ ] **Step 2: Replace raw console calls in the entrypoint**

In `src/index.ts`:

Add the import (next to the existing `env` import):
```ts
import { logger } from './infrastructure/logging/logger'
```

Replace the three `console.*` calls:
- `console.info(\`🦊 Restaurant order server running...\`)` → `logger.info({ port: env.port }, '🦊 Restaurant order server running')`
- Both `console.error('Error during shutdown:', err)` → `logger.error({ err }, 'error during shutdown')`

- [ ] **Step 3: Typecheck the whole project**

Run:
```bash
bun run typecheck
```
Expected: no errors (Task 3's app-level break is now resolved).

- [ ] **Step 4: Run the full logging suite + lint**

Run:
```bash
bun test test/logging && bun run lint
```
Expected: all logging tests PASS; lint clean.

- [ ] **Step 5: Manual smoke (dev output is colorized)**

Run (Ctrl-C after the banner prints; requires a `DATABASE_URL`, otherwise just confirm the banner line is colorized pino output rather than a plain string):
```bash
bun run dev
```
Expected: startup line rendered by pino-pretty (timestamp + level + message), not the old raw string. Hitting `GET /api/health` in another shell prints a `debug` access line; any other route prints an `info` access line.

- [ ] **Step 6: Commit**

```bash
git add src/presentation/http/app.ts src/index.ts
git commit -m "feat(logging): wire request logging and pino into app and entrypoint"
```

---

## Notes for the implementer

- **Elysia context props:** `requestId`/`startTime` come from a global `derive`; `path` and `set.status` are standard context fields. If a future Elysia version changes how `set.status` surfaces in `onAfterResponse`, the `?? 200` fallback keeps the access log correct for success responses — adjust only if a test shows a wrong status.
- **Why factories:** `requestLogger(log?)` and `errorHandler(log?)` accept an optional logger purely so tests can capture output; app code calls them with no argument and gets the shared instance.
- **Do not import `app.ts` in new tests** — it initializes the DB client. Build minimal `new Elysia()` apps in tests instead.
