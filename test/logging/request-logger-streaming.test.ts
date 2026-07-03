import { describe, expect, it } from 'bun:test'
import { Elysia, sse } from 'elysia'
import { pino, type Logger } from 'pino'

import { requestLogger } from '../../src/presentation/http/plugins/request-logger'

function capture(): { log: Logger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = []
  const log = pino(
    { level: 'debug' },
    {
      write: (s: string) => {
        lines.push(JSON.parse(s))
      },
    },
  )
  return { log, lines }
}

/**
 * Mirrors the shape of the real SSE routes (src/presentation/http/routes/stream.ts):
 * an `async function*` handler that `yield`s `sse({ event, data })` chunks. No database,
 * no broker — just enough of the pattern to exercise requestLogger's mapResponse hook
 * against a streaming response instead of a plain one.
 */
describe('request-logger + streaming (SSE) response', () => {
  it('logs exactly one access line and leaves the streamed body fully intact', async () => {
    const { log, lines } = capture()
    const app = new Elysia().use(requestLogger(log)).get('/stream', async function* () {
      for (let i = 0; i < 3; i++) {
        yield sse({ event: 'order_item.updated', data: { orderItemId: i, status: 'ready' } })
      }
    })

    const res = await app.handle(new Request('http://localhost/stream'))

    // The stream itself must be untouched by mapResponse: all chunks present, in order.
    const body = await res.text()
    const chunks = [0, 1, 2].map(
      (i) => `event: order_item.updated\ndata: {"orderItemId":${i},"status":"ready"}`,
    )
    let cursor = -1
    for (const chunk of chunks) {
      const idx = body.indexOf(chunk)
      expect(idx).toBeGreaterThan(cursor)
      cursor = idx
    }

    // requestLogger must emit exactly one access log line for the whole request, not
    // zero (hook skipped for streams) and not one per chunk (hook re-fires per yield).
    expect(lines).toHaveLength(1)
    const line = lines[0] as Record<string, unknown>
    expect(line.status).toBe(200)
    expect(line.method).toBe('GET')
    expect(line.path).toBe('/stream')
    expect(typeof line.durationMs).toBe('number')
  })
})
