import { describe, expect, it } from 'bun:test'

import { createLogger, safeErrSerializer } from '../../src/infrastructure/logging/logger'

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
    const { stream, lines } = capture()
    const log = createLogger({ level: 'error', stream })

    log.error({ err: new Error('boom') }, 'unhandled')

    const record = lines[0] as { err: { type: string; message: string; stack: string } }
    expect(record.err).toBeDefined()
    expect(record.err.type).toBe('Error')
    expect(record.err.message).toBe('boom')
    expect(typeof record.err.stack).toBe('string')
    expect(record.err.stack).toBeTruthy()
  })

  it('strips extra error properties that could carry sensitive data (US-030)', () => {
    const { stream, lines } = capture()
    const log = createLogger({ level: 'error', stream })

    // Simulates a `pg` constraint-violation error, whose `detail` often echoes back the
    // offending user-submitted value.
    const dbError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      detail: 'Key (email)=(user@example.com) already exists.',
      table: 'users',
      column: 'email',
    })
    log.error({ err: dbError }, 'unhandled error')

    const record = lines[0] as { err: Record<string, unknown> }
    expect(Object.keys(record.err).toSorted()).toEqual(['message', 'stack', 'type'])
    expect(JSON.stringify(record)).not.toContain('user@example.com')
  })

  it('redacts token fields', () => {
    const { stream, lines } = capture()
    const log = createLogger({ level: 'info', stream })

    log.info({ token: 'secret-token-value' }, 'x')

    const record = lines[0] as { token: string }
    expect(record.token).toBe('[REDACTED]')
    expect(JSON.stringify(record)).not.toContain('secret-token-value')
  })

  it('safeErrSerializer passes non-Error values through unchanged', () => {
    expect(safeErrSerializer('not-an-error')).toBe('not-an-error')
    expect(safeErrSerializer(undefined)).toBeUndefined()
  })
})
