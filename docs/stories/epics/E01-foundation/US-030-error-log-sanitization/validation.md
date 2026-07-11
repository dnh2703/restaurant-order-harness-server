# Validation — US-030 Sanitize error objects before logging

## Proof Strategy

Prove the serializer emits only `{ type, message, stack }` for any `Error`, including one with
extra own-enumerable properties (simulating a pg `DatabaseError` with `detail`/`table`
attached), and that existing call sites (`error-handler.ts`, `dish-image-storage.ts`,
`index.ts`) still log through the sanitized shape without behavior change otherwise.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Serializer given a plain `Error` → `{ type, message, stack }` only. Given `Object.assign(new Error('duplicate key'), { detail: 'Key (email)=(a@b.com) already exists.', table: 'users' })` → output has no `detail`/`table` keys. Given a non-`Error` value → passed through unchanged (defensive). |
| Integration | Existing `unhandled error` integration coverage (error-handler suite) still passes; assert the captured log line's `err` field has exactly the expected keys, no extras. |
| E2E | |
| Platform | Manual: trigger a real DB constraint violation locally (e.g. duplicate unique key), confirm `detail`/`table`/etc. are absent from the printed log line. |
| Release | |

## Fixtures

- Synthetic `Error` instances with attached extra properties (no DB fixtures needed for the
  unit-level proof).

## Commands

```text
bun test test/logging         # or the file covering the pino serializer
bun test                      # full suite stays green
bun run typecheck && bun run lint
```

## Acceptance Evidence

Add results after verification.
