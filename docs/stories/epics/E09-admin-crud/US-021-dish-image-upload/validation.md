# Validation

## Proof Strategy

The use case must reject every invalid input (missing / wrong type / oversize)
before any storage call, generate a tenant-scoped non-client-controlled key, and
return the configured public URL on success. The route must enforce ADMIN + auth
and map each failure to the correct status. All automated tests inject a fake
storage port; no test touches real R2. A manual smoke against a real R2 bucket
confirms the `Bun.S3Client` wiring and public URL resolve end to end.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | reject missing file → `IMAGE_MISSING`; reject `application/pdf`/`image/gif` → `IMAGE_TYPE_UNSUPPORTED`; reject >5 MB → `IMAGE_TOO_LARGE`; key format `dishes/<restaurantId>/<uuid>.<ext>` with ext from content-type (mocked uuid); storage failure → `STORAGE_UNAVAILABLE`; success returns `publicUrl(key)` |
| Integration | ADMIN uploads valid jpeg/png/webp → 201 `{ data: { url } }` and fake storage received the bytes+key; CASHIER → 403; no token → 401; unsupported type → 400; oversize → 400; missing field → 400 |
| E2E | n/a (admin UI file picker is out of scope) |
| Platform | n/a |
| Performance | n/a (5 MB cap bounds request size) |
| Logs/Audit | success logs object key + byte size; `STORAGE_UNAVAILABLE` logs R2 error cause |

## Fixtures

- Deterministic ADMIN, CASHIER, and no-token requests (reuse existing auth test
  helpers).
- In-memory fake `DishImageStorage` capturing `{ key, contentType, bytes }` and a
  variant whose `put` throws, to prove `STORAGE_UNAVAILABLE`.
- Sample bytes for jpeg/png/webp; a >5 MB buffer; a disallowed-type buffer.
- Mocked uuid for deterministic key assertions.

## Commands

```text
bun test test/menu-items/upload-dish-image.test.ts
bun test           # full suite
bun run typecheck && bun run lint && bun run format:check
```

## Acceptance Evidence

Add results after verification.
