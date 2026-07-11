# US-029 Pin `Content-Disposition: inline` on uploaded dish images

## Status

planned

## Lane

normal

## Product Contract

Dish images written to R2 (US-021) carry an explicit `Content-Disposition: inline` object
header, so browsers render the (magic-byte-validated, per US-025) bytes instead of defaulting
to platform/CDN behavior. `X-Content-Type-Options: nosniff` on the served response is **out of
scope** — it is Cloudflare/R2-edge configuration outside this repo's ownership (corrected
follow-up to decision 0024; tracked as an external deployment task, not a story here).

## Relevant Product Docs

- `docs/decisions/0021-dish-image-storage-r2.md`
- `docs/decisions/0024-log-and-upload-hardening.md` (follow-up correction)
- `docs/decisions/0025-low-severity-auth-and-log-hardening.md`

## Acceptance Criteria

- `createR2DishImageStorage`'s `put()` writes each object with `contentDisposition: 'inline'`
  in addition to the existing `type` (content-type) metadata.
- No change to `DishImageStorage.put()`'s public signature, `publicUrl()`, the upload API
  response shape, or any existing behavior beyond the object metadata written to R2.
- No regression: full suite green; existing R2 manual-smoke pattern (see US-021 evidence)
  remains valid.

## Design Notes

- Commands: none (infra adapter change only).
- Queries: none.
- API: `src/infrastructure/storage/dish-image-storage.ts` —
  `client.write(key, bytes, { type: contentType, contentDisposition: 'inline' })`.
- Tables: none.
- Domain rules: none.
- UI surfaces: none — this only affects how a browser handles the response when an image URL
  is opened directly; the admin/customer image `<img>` rendering path is unaffected either way.

## Validation

`scripts/bin/harness-cli story update --id US-029 --unit 0 --integration 0 --e2e 0 --platform 1`

| Layer | Expected proof |
| --- | --- |
| Unit | |
| Integration | |
| E2E | |
| Platform | manual R2 smoke (same live-bucket pattern as US-021/US-025): uploaded object's
`Content-Disposition` header reads `inline` when fetched. |
| Release | |

## Harness Delta

No new decision — single metadata addition on an existing infra adapter, not a hard gate.
Corrects decision 0024's follow-up note that `Content-Disposition` was out-of-repo; it is
code-owned via Bun's `S3Client.write()` options (see decision 0025).

## Evidence

Add after implementation.
