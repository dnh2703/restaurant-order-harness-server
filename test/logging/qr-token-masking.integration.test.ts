import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
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
 * US-025: driving a real QR request through the request logger must not leave the raw
 * qrToken anywhere in the emitted access-log line — the path is masked to `/api/qr/:qrToken/...`.
 */
describe('request-logger qrToken masking (integration)', () => {
  it('masks the qrToken in the logged path and message, and never logs the raw token', async () => {
    const { log, lines } = capture()
    const token = 'secret-qr-token-abc123'
    const app = new Elysia({ prefix: '/api' })
      .use(requestLogger(log))
      .get('/qr/:qrToken/order', () => ({ data: 'ok' }))

    const res = await app.handle(new Request(`http://localhost/api/qr/${token}/order`))
    expect(res.status).toBe(200)

    expect(lines).toHaveLength(1)
    const line = lines[0]!
    expect(line.path).toBe('/api/qr/:qrToken/order')
    expect(line.msg).toBe('GET /api/qr/:qrToken/order 200')
    // The raw token must appear nowhere in the serialized line.
    expect(JSON.stringify(line)).not.toContain(token)
  })

  it('leaves a non-QR path unchanged in the log', async () => {
    const { log, lines } = capture()
    const app = new Elysia({ prefix: '/api' })
      .use(requestLogger(log))
      .get('/kitchen/queue', () => ({ data: 'ok' }))

    await app.handle(new Request('http://localhost/api/kitchen/queue'))
    expect(lines[0]!.path).toBe('/api/kitchen/queue')
  })
})
