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

Verified 2026-07-03 (TDD).

- Unit (`test/menu-items/upload-dish-image.test.ts`, fake storage, no DB): 6 pass — rejects
  missing/empty → `IMAGE_MISSING`; `image/gif` & `application/pdf` → `IMAGE_TYPE_UNSUPPORTED`;
  `> 5 MB` → `IMAGE_TOO_LARGE`; success stores under `dishes/<restaurantId>/<uuid>.<ext>` with the
  right content type and returns `publicUrl(key)`; jpeg/png/webp → `jpg`/`png`/`webp`; storage
  throw → `STORAGE_UNAVAILABLE`. No storage call happens on any rejection.
- Integration (`test/menu-items/upload-dish-image-route.integration.test.ts`, live Neon for auth,
  injected fake storage): 5 pass — CASHIER 403, no token 401; ADMIN valid webp → 201 with tenant
  key + public URL and the fake received the bytes; unsupported type → 400 `IMAGE_TYPE_UNSUPPORTED`;
  oversize → 400 `IMAGE_TOO_LARGE`; missing field → 400 `IMAGE_MISSING`.
- Full suite: `bun test` → **244 pass / 0 fail** across 53 files. `typecheck`, `oxlint`,
  `prettier --check` all clean.

Not covered by automated tests (manual step): the real `Bun.S3Client` → Cloudflare R2 network
write. `createR2DishImageStorage` is infra wiring (like `database/client.ts`) proven by a manual
smoke once an R2 bucket + `R2_*` credentials are provisioned:

```text
# with R2_* set in .env, ADMIN token in $TOKEN:
curl -sS -X POST http://localhost:3000/api/menu-items/image \
  -H "authorization: Bearer $TOKEN" -F file=@sample.webp
# expect: 201 {"data":{"url":"https://<public-base>/dishes/<restaurantId>/<uuid>.webp"}}
# then open the url and confirm the image loads.
```
