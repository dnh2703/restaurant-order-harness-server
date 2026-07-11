# Overview — US-030 Sanitize error objects before logging

## Status

planned

## Current Behavior

`baseOptions()` (`src/infrastructure/logging/logger.ts:10-26`) configures pino's `err`
serializer as `stdSerializers.err`, which spreads every enumerable property of a thrown
`Error` into the logged object (beyond the standard `type`/`message`/`stack`). This serializer
is shared by every call site in the app that logs `{ err }`:
`src/presentation/http/plugins/error-handler.ts:48` (unhandled request errors),
`src/infrastructure/storage/dish-image-storage.ts:39` (R2 upload failures), and
`src/index.ts:16,22` (shutdown errors). Driver-level errors — notably `pg` errors on
constraint violations — carry extra fields such as `detail`, `hint`, `table`, `column`, and
query context; `detail` in particular often echoes the offending value back
(e.g. `Key (email)=(user@example.com) already exists.`), which lands unredacted in
application logs. The existing pino `redact.paths` list only covers header/token-shaped
paths, not arbitrary `err.*` sub-fields.

## Target Behavior

Every `log.error({ err }, ...)` call site logs a fixed, bounded error shape —
`{ type, message, stack }` — regardless of what extra properties the thrown error happens to
carry. No error's uncontrolled own-properties (pg `detail`/`hint`/`table`/`column`/query text,
or anything a future error source might attach) ever reach log output.

## Affected Users

None client-facing — response bodies are unchanged (already redacted per existing
`error-handler.ts` behavior: internal error `message` is only exposed outside production).
This is a server-side log-content change only.

## Affected Product Docs

- `docs/decisions/0025-low-severity-auth-and-log-hardening.md`
- `docs/decisions/0024-log-and-upload-hardening.md` (sibling log-hardening context — qrToken
  path masking)

## Non-Goals

- Changing the HTTP error response envelope or exposed `message` behavior.
- Adding structured error codes/taxonomy.
- Redacting fields on `AppError` instances — those already take a separate return path above
  the raw-`err`-logging branch in `error-handler.ts` and never reach the serializer with their
  full shape logged.
