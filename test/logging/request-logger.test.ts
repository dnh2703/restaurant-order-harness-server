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
