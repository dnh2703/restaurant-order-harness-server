# Exec Plan

## Goal

Let ADMIN upload a dish image file from their machine and get back a public URL
to store on the dish, replacing the URL-paste-only workflow, using Cloudflare R2.

## Scope

In scope:

- `infrastructure/storage/r2-client.ts` storage port over `Bun.S3Client`.
- `application/menu-items/upload-dish-image.ts` use case (type/size validation,
  key generation, put, public URL).
- `POST /api/menu-items/image` route (ADMIN, multipart) in `routes/menu-items.ts`.
- New error-catalog codes: `IMAGE_MISSING`, `IMAGE_TYPE_UNSUPPORTED`,
  `IMAGE_TOO_LARGE`, `STORAGE_UNAVAILABLE`.
- Env config for R2 + `.env.example` + `docs/product/menu.md` /
  `api-conventions.md` updates.
- Unit + integration tests with an injected fake storage port.

Out of scope:

- Orphan cleanup on replace/delete (backlog).
- Image processing (resize/thumbnail/convert).
- Private buckets / signed reads.
- Admin frontend file picker.
- Changing create/update DTOs.

## Risk Classification

Risk flags:

- External systems (Cloudflare R2 provider) — hard gate.
- Public contracts (new multipart endpoint, new error codes).
- Audit/security (untrusted file input: type + size validation, server-generated
  keys).
- Existing behavior (US-015 image-source workflow changes).

Hard gates:

- External provider behavior (R2). Human explicitly chose the high-risk lane;
  scope kept bounded (public bucket, server-proxied upload, no schema change).

## Work Phases

1. Discovery — done (schema, env, deps, product docs reviewed at intake).
2. Design — done (this packet + decision 0021).
3. Validation planning — see `validation.md`.
4. Implementation — storage port → use case → route → error codes → env → docs.
5. Verification — `bun test` (unit + integration with fake storage), typecheck,
   lint, format; manual R2 smoke against a real bucket.
6. Harness update — story proof via `harness-cli story update`, trace, close the
   deferred-cleanup backlog note if scope changes.

## Stop Conditions

Pause for human confirmation if:

- A schema/migration turns out to be needed after all.
- R2 requires credentials or a bucket policy the human must provision before
  the endpoint can be smoke-tested.
- Validation requirements (type/size limits) need to be weakened.
- Architecture direction changes (e.g. moving to presigned uploads).
