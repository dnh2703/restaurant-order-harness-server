# Design — US-030 Sanitize error objects before logging

## Domain Model

No entity changes. This is a cross-cutting logging-infrastructure invariant.

## Application Flow

Single choke point: `baseOptions()` in `src/infrastructure/logging/logger.ts`. All three
`log.error({ err }, ...)` call sites (`error-handler.ts`, `dish-image-storage.ts`, `index.ts`)
share this one pino instance/config, so fixing the serializer there covers all of them with
one change instead of three, and forecloses the same leak in any future call site.

Current:

```ts
serializers: { err: stdSerializers.err },
```

Target:

```ts
serializers: {
  err: (error: unknown) => {
    if (!(error instanceof Error)) return error
    return { type: error.name, message: error.message, stack: error.stack }
  },
},
```

## Interface Contract

No HTTP/DTO change. Only the shape of the `err` field in emitted log lines changes (fewer
keys: `type`/`message`/`stack` only, never additional own-properties).

## Data Model

No tables, indexes, or migrations.

## UI / Platform Impact

None.

## Observability

This story *is* the observability change: unhandled-error and storage-error logs become
narrower by design, not richer. Production logs lose driver-specific debug fields (pg
`detail`/`hint`/`table`/`column`/query context) that were previously (accidentally) present.

## Alternatives Considered

1. Redact specific known-risky sub-fields (`err.detail`, `err.hint`, ...) via pino's
   `redact.paths` — rejected; allowlist-by-exclusion, and every new error source (pg today,
   any future SDK) needs its own reactive redact path added after the fact.
2. Restrict the fix to `instanceof DatabaseError` (pg-specific) — rejected; leaves any other
   custom `Error` subtype with extra properties still fully spread. A safe-by-default
   fixed-field shape (name/message/stack only) covers all error types uniformly with less
   code.
3. Fix only the `error-handler.ts` call site — rejected once discovery showed the serializer
   is shared by three call sites; a shared fix is simpler and more durable than three local
   ones.
