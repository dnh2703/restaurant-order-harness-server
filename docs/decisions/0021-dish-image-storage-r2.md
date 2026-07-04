# 0021 Dish Image Storage on Cloudflare R2

Date: 2026-07-03

## Status

Accepted

## Context

Admin could only set a dish image by pasting an external URL; there was no way to
upload a file from their machine (US-021 pain). The app had no object storage
wired in. Adding a cloud storage provider is an external-provider hard gate under
`docs/FEATURE_INTAKE.md`, so the direction needed a durable decision: which
provider, upload mechanism, bucket visibility, endpoint shape, and client
library.

## Decision

- **Provider:** Cloudflare R2 (S3-compatible), public-read bucket. Menu photos
  are public by nature, so images are served directly by public URL stored in
  `menu_items.image_url`.
- **Upload mechanism:** server-proxied `multipart/form-data`. The server
  validates content-type and size, then streams to R2. Validation stays
  centralized server-side.
- **Endpoint:** standalone `POST /api/menu-items/image` (ADMIN, tenant-scoped)
  returning `{ data: { url } }`, usable both when creating a new (not-yet-saved)
  dish and when updating an existing one.
- **Client library:** `Bun.S3Client` (built into Bun, R2-compatible) — no new
  npm dependency.
- **Object key:** server-generated `dishes/<restaurantId>/<uuid>.<ext>`;
  `restaurantId` from the auth token. Clients never control the key/path.
- **Backward compatibility:** the `imageUrl` field on create/update still accepts
  any string; external URLs keep working. No schema migration.

## Alternatives Considered

1. Presigned direct-to-R2 upload — lighter server load but loses server-side
   content validation and adds a two-step client flow. Rejected.
2. Private bucket + signed/proxied reads — unnecessary for public menu photos.
   Rejected.
3. `@aws-sdk/client-s3` — heavier dependency than the built-in `Bun.S3Client`.
   Rejected.
4. Binding upload to `POST /api/menu-items/:id/image` — unusable while creating a
   dish that has no id yet. Rejected.

## Consequences

Positive:

- Admin uploads directly; no external image hosting needed.
- Zero new npm dependencies; no schema change; existing URL workflow preserved.
- Tenant-scoped keys and server-side validation bound the security surface.

Tradeoffs:

- Upload bytes pass through the server (bounded by a 5 MB cap).
- Public bucket means anyone with the URL can read an image (acceptable for menu
  photos).
- Replaced/deleted images leave orphaned R2 objects until cleanup is implemented.

## Follow-Up

- Implement orphaned-object cleanup on image replace / dish delete (deferred to
  the harness backlog).
- Provision the R2 bucket + credentials and set `R2_*` env vars before the
  endpoint can be smoke-tested / deployed.
