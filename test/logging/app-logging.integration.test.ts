import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { pino, stdSerializers, type Logger } from 'pino'

import { errorHandler } from '../../src/presentation/http/plugins/error-handler'
import { requestLogger } from '../../src/presentation/http/plugins/request-logger'

function capture(): { log: Logger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = []
  const log = pino(
    { level: 'debug', serializers: { err: stdSerializers.err } },
    {
      write: (s: string) => {
        lines.push(JSON.parse(s))
      },
    },
  )
  return { log, lines }
}

describe('request-logger + error-handler composition', () => {
  it('emits an access log line with status 500 for a thrown error', async () => {
    const { log, lines } = capture()
    const app = new Elysia()
      .use(requestLogger(log))
      .use(errorHandler(log))
      .get('/boom', () => {
        throw new Error('kaboom')
      })

    await app.handle(new Request('http://localhost/boom'))

    // The access line from request-logger (has durationMs); status 500, error level.
    const access = lines.find((l) => typeof l.durationMs === 'number')
    expect(access).toBeDefined()
    expect(access!.status).toBe(500)
    expect(access!.level).toBe(50)
  })
})
