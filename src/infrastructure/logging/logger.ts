import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino'
import pretty from 'pino-pretty'

import { env } from '../config/env'

/**
 * US-030: a fixed-field error serializer, in place of pino's `stdSerializers.err`. The
 * standard serializer spreads every enumerable property of an Error, and driver errors (e.g.
 * pg constraint violations) carry `detail`/`hint`/`table`/`column`/query context — `detail`
 * in particular often echoes back the offending user-submitted value. Limiting to
 * name/message/stack keeps every `log.error({ err }, ...)` call site safe by default.
 */
export function safeErrSerializer(error: unknown): unknown {
  if (!(error instanceof Error)) return error
  return { type: error.name, message: error.message, stack: error.stack }
}

/**
 * Shared pino configuration. Redaction is belt-and-suspenders: the request logger
 * never logs headers/bodies, but if a token ever reaches a log field it is censored.
 */
export function baseOptions(): LoggerOptions {
  return {
    level: env.logLevel,
    serializers: { err: safeErrSerializer },
    redact: {
      paths: [
        'req.headers.authorization',
        'headers.authorization',
        'authorization',
        'token',
        '*.token',
        'req.body.token',
      ],
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
