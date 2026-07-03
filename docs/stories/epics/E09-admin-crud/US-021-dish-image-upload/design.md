# Design

## Domain Model

No new domain entity. A dish image is an opaque binary asset addressed by a
tenant-scoped object key and served via a public URL stored in the existing
`menu_items.image_url` column (`text`, nullable). Business rules:

- Only `image/jpeg`, `image/png`, `image/webp` are accepted.
- Max size 5 MB (`MAX_DISH_IMAGE_BYTES` constant).
- Object key is server-generated: `dishes/<restaurantId>/<uuid>.<ext>`. The
  client never supplies any part of the key or path (no traversal, no tenant
  spoofing — `restaurantId` always comes from the auth token).

## Application Flow

`uploadDishImageUseCase(storage, restaurantId, file)`:

1. Reject when no file is present → `IMAGE_MISSING`.
2. Reject unsupported `file.type` → `IMAGE_TYPE_UNSUPPORTED`.
3. Reject `file.size > MAX_DISH_IMAGE_BYTES` → `IMAGE_TOO_LARGE`.
4. Derive extension from the validated content-type; generate key
   `dishes/<restaurantId>/<uuid>.<ext>`.
5. `await storage.put(key, bytes, contentType)`; on failure → `STORAGE_UNAVAILABLE`.
6. Return `storage.publicUrl(key)`.

The use case receives a `DishImageStorage` port as its first argument so tests
inject a fake and never touch real R2. It has no Elysia/HTTP dependency.

## Interface Contract

### Storage port — `infrastructure/storage/r2-client.ts`

```ts
interface DishImageStorage {
  put(key: string, bytes: Uint8Array | ArrayBuffer, contentType: string): Promise<void>
  publicUrl(key: string): string
}
```

Backed by `Bun.S3Client` configured for R2 (`endpoint`
`https://<accountId>.r2.cloudflarestorage.com`, `region: "auto"`, bucket +
access key/secret from env). `publicUrl` joins `R2_PUBLIC_BASE_URL` + key. Reads
env exactly once at module load. Zero new npm dependencies.

### HTTP — `POST /api/menu-items/image`

- Auth: ADMIN (existing `authGuard` + `guard({ auth: ['ADMIN'] })` on the route group).
- Request: `multipart/form-data`, field `file` (Elysia `t.File`).
- `201` → `{ data: { url: string } }`.
- Errors (via error-catalog, standard error envelope):
  - `IMAGE_MISSING` → 400
  - `IMAGE_TYPE_UNSUPPORTED` → 400
  - `IMAGE_TOO_LARGE` → 400
  - `STORAGE_UNAVAILABLE` → 503
  - Unauthenticated → 401; non-ADMIN → 403 (from guard).

Create/update menu-item routes and DTOs are **unchanged**; `imageUrl` still
accepts any string.

## Data Model

No migration. Reuses `menu_items.image_url`. The value stored is now typically a
URL under `R2_PUBLIC_BASE_URL`, but the column contract is unchanged (any URL
string, including external ones).

## Config

`infrastructure/config/env.ts` gains (grouped as "Storage (US-021)"):

- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
  `R2_PUBLIC_BASE_URL`.
- Required in production. Outside production they are optional; when unset the
  storage port is constructed lazily and only the upload endpoint fails
  (`STORAGE_UNAVAILABLE`), so `bun test` and unrelated dev work need no R2
  credentials (mirrors the `authJwtSecret` dev-fallback pattern).
- `.env.example` documents all five keys.

## UI / Platform Impact

Server contract only. Admin frontend will switch its image field from a URL
input to a file picker that calls this endpoint then submits the returned URL —
out of scope here.

## Observability

Upload success/failure logged via the existing pino logger (request-logger
covers the route). Log object key and byte size on success; log the R2 error
cause on `STORAGE_UNAVAILABLE`. No new audit table.

## Alternatives Considered

1. **Presigned direct-to-R2 upload** — lighter server load but a two-step client
   flow and server-side content validation is lost. Rejected for a small admin
   tool; server-proxied multipart keeps validation centralized.
2. **Private bucket + signed GET / proxy reads** — unnecessary for public menu
   photos; adds latency and complexity. Rejected.
3. **`@aws-sdk/client-s3`** — heavier dependency; `Bun.S3Client` is built in and
   R2-compatible. Rejected to keep the dependency set minimal.
4. **Bind upload to `POST /api/menu-items/:id/image`** — cannot be used while
   creating a not-yet-persisted dish. Rejected in favor of a standalone endpoint
   that returns a URL usable in both create and update.
