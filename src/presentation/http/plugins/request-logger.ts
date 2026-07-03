import { randomUUID } from 'node:crypto'

import { Elysia } from 'elysia'
import type { Logger } from 'pino'

import { logger as defaultLogger } from '../../../infrastructure/logging/logger'

/**
 * Access logging via Elysia's own lifecycle hooks (no third-party plugin).
 * `derive` (global) tags every request with an id + start time so handlers and the
 * error handler can correlate; `mapResponse` emits exactly one line per request.
 *
 * NOTE: the brief originally called for `onAfterResponse`, but under Elysia 1.4.29
 * that hook is scheduled onto a macrotask *after* `app.handle()` already resolves
 * (confirmed empirically: it fires only after an intervening `setTimeout(0)`, not
 * after several microtask ticks). That breaks hermetic tests that assert on captured
 * log lines immediately after `await app.handle(...)`. `mapResponse` runs synchronously
 * in the same tick as the rest of the request pipeline — including for thrown errors,
 * where `set.status` has already been finalized to the mapped error status — so it
 * gives the same one-line-per-request semantics without the timing gap. Returning
 * nothing from the hook leaves Elysia's own response untouched.
 *
 * The logger is injectable so tests can capture output; production uses the shared one.
 */
export function requestLogger(log: Logger = defaultLogger) {
  return new Elysia({ name: 'request-logger' })
    .derive({ as: 'global' }, () => ({
      requestId: randomUUID(),
      startTime: performance.now(),
    }))
    .mapResponse({ as: 'global' }, (ctx) => {
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
