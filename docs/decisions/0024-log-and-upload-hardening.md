# 0024 Log & upload hardening — mask qrToken in logs, validate image bytes

Date: 2026-07-04

## Status

Accepted

## Context

The 2026-07-04 security audit found two MEDIUM issues that both touch the audit/security
hard gate:

1. The customer `qrToken` — the *only* authorization for reading/placing a table's orders —
   is written verbatim into every access-log line, because `request-logger.ts` logs the raw
   request `path` (`/api/qr/<qrToken>/order`) and the pino redaction covers header/body
   `token` fields but not `path`. Anyone with log access effectively holds table
   credentials.
2. Dish-image uploads validate file type only by the client-supplied `Content-Type`; the
   bytes are never inspected, so an ADMIN can store arbitrary content labelled `image/png`.
   The bucket serves it as `image/*` (so not a clean stored-XSS), but there is no
   server-side guarantee that stored objects are images.

Because the work handles a sensitive capability token and access-log content, per
FEATURE_INTAKE it enters the high-risk lane and warrants a durable decision. Tracked as
**US-025**.

## Decision

1. **Mask the token segment of QR paths before logging.** Access-log lines show a route
   template (`/api/qr/:qrToken/...`), never a live token. Other log fields are unchanged.
2. **Validate uploaded image bytes against a magic-byte signature** (JPEG/PNG/WebP) in the
   upload use-case, in addition to the existing MIME allow-list and 5 MB size check; reject
   a mismatch before the R2 write.

## Alternatives Considered

1. Salted-hash the token in logs (keeps per-session correlation) — deferred; reintroduces a
   weaker identifier and needs a salt secret, and no current need for log correlation.
2. Drop `path` from the access log entirely — rejected; loses useful routing info for all
   non-secret endpoints.
3. Keep trusting MIME and rely on the bucket serving `image/*` — rejected; no server-side
   guarantee the stored object is an image, and it makes the bucket an arbitrary-content
   host under a trusted domain.

## Consequences

Positive:

- The customer capability token no longer leaks through logs.
- Stored dish images are guaranteed to be real images by their bytes.

Tradeoffs:

- Log lines for QR routes lose per-token granularity (acceptable; correlation can be added
  later via a salted hash if needed).
- Upload gains one rejection path; clients that sent mislabelled non-images now get a 4xx.

## Follow-Up

- Implement US-025.
- Bucket/CDN `X-Content-Type-Options: nosniff` + `Content-Disposition` remain out-of-repo
  config, noted in the audit but not owned by this decision.
- The `imageUrl`-accepts-any-string LOW finding is not covered here.
