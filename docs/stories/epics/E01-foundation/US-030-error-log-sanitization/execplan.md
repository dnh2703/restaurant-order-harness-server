# Exec Plan — US-030 Sanitize error objects before logging

## Goal

Every `err` field written to logs anywhere in the app is limited to `{ type, message, stack }`
— no error's extra own-properties ever reach log output.

## Scope

In scope:

- `baseOptions()` in `src/infrastructure/logging/logger.ts` — the single shared serializer
  choke point covering all three current call sites (`error-handler.ts`,
  `dish-image-storage.ts`, `index.ts`).

Out of scope:

- Changing what non-`err` fields are logged (`requestId`, `key`, etc. are unaffected).
- Changing the HTTP response envelope.
- Adding a `details`/`code` extraction path for `AppError` (already handled separately, above
  the raw-`err` branch).

## Risk Classification

Risk flags:

- Audit/security (log content can carry user-submitted or schema-internal values).
- Existing behavior (changes what's captured in production logs; could reduce debuggability
  for a real incident that would have relied on the extra fields).

Hard gates:

- Audit/security.

## Work Phases

1. Discovery — enumerate every `log.error`/`logger.error({ err })` call site (done: 3 sites,
   1 shared serializer — see design.md).
2. Design — fixed-field serializer shape.
3. Validation planning — unit-test the serializer directly with a synthetic error carrying
   extra own-properties (simulating a pg constraint-violation error).
4. Implementation — smallest change in `logger.ts`.
5. Verification — `bun test`, typecheck, lint.
6. Harness update — record proof via `harness-cli story update`.

## Stop Conditions

Pause for human confirmation if:

- Any current call site is found to depend on the extra fields for an already-relied-upon
  debugging workflow with no viable local-reproduction alternative — none expected, but flag
  if discovered during implementation.
