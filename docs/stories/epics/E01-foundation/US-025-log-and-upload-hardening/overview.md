# Overview — US-025 Log & upload hardening

## Status

planned

## Current Behavior

Two MEDIUM findings from the 2026-07-04 security audit that both touch the audit/security
gate:

1. **`qrToken` leaks into access logs.** `request-logger.ts:49` logs the raw request `path`;
   for QR routes the path is `/api/qr/<qrToken>/order` etc. The pino `redact` list covers
   `authorization`/`token` fields but not `path`, so the customer's *only* capability token
   is written to every access-log line. Anyone with log access can open sessions and
   read/place orders for that table.
2. **Uploaded file type validated by client-supplied MIME only.** `upload-dish-image.ts:35-36`
   trusts the multipart part's `Content-Type`; the actual bytes are never inspected. An ADMIN
   can store arbitrary content labelled `image/png`. (R2 serves it with a filtered `image/*`
   content-type, so it is not a clean stored-XSS vector, but there is no server-side guarantee
   stored objects are real images.)

## Target Behavior

1. QR access-log lines mask the token segment (e.g. log a route template `/api/qr/:qrToken/...`
   or a stable hash), so a full `qrToken` never appears in logs. Other log fields unchanged.
2. Image upload verifies the file's magic bytes match an allowed image signature
   (JPEG/PNG/WebP) and rejects on mismatch, in addition to the existing MIME + size checks.

## Affected Users

- Customers — their table capability token is no longer exposed via logs.
- Operators / anyone with log access — no longer incidentally hold table credentials.
- `ADMIN` uploaders — a mislabelled non-image is now rejected server-side.

## Affected Product Docs

- `docs/product/auth-authorization.md` (qrToken is the customer's authorization)
- `docs/product/tables-qr.md`
- `docs/decisions/0024-log-and-upload-hardening.md`

## Non-Goals

- Redacting non-QR paths or changing the access-log schema beyond the token segment.
- Re-encoding/transcoding images or stripping metadata.
- `Content-Disposition`/`nosniff` at the bucket/CDN (out-of-repo config; noted in the audit).
- The `imageUrl`-accepts-any-string LOW finding (tracked separately if pursued).
