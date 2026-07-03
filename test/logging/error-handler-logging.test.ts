import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { pino, stdSerializers, type Logger } from 'pino'

import { errorHandler } from '../../src/presentation/http/plugins/error-handler'

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
