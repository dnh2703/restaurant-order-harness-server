# Exec Plan — US-025 Log & upload hardening

## Goal

Stop leaking the customer `qrToken` into access logs, and guarantee server-side that an
uploaded dish image is actually an image (magic-byte check), without changing the public
success contracts.

## Scope

In scope:

- Mask the token segment of QR request paths in the access log (`request-logger.ts`).
- Add magic-byte signature validation for JPEG/PNG/WebP in the upload use-case
  (`upload-dish-image.ts`), rejecting mismatches with the existing `IMAGE_TYPE_UNSUPPORTED`
  (or a sibling) error.
- Keep the existing MIME allow-list and 5 MB size check as defense-in-depth.

Out of scope:

- Global body-size limit / security headers / docs gating — sibling story US-024.
- Bucket/CDN response-header config (nosniff, Content-Disposition).
- `imageUrl` external-URL validation (LOW).

## Risk Classification

Risk flags:

- Auth (qrToken is the customer capability credential).
- Audit/security (access-log content; sensitive-token handling).
- External systems (R2 upload path).
- Existing behavior (log line format changes; upload gains a rejection case).
- Weak proof (no current test asserts the token is absent from logs, nor byte validation).

Hard gates:

- Audit/security.

## Work Phases

1. Discovery — confirm every route whose path contains a secret (QR routes); confirm the
   Bun `File`/multipart API exposes the leading bytes for a signature check.
2. Design — masking strategy (route template vs hash) and the exact magic-byte table; settle
   in `design.md`.
3. Validation planning — a test that asserts no raw `qrToken` appears in an emitted log line,
   and upload tests for each accepted signature + a mismatched-bytes rejection.
4. Implementation — smallest changes in `request-logger.ts` and `upload-dish-image.ts`.
5. Verification — `bun test`, typecheck, lint; manual log inspection on a QR request.
6. Harness update — record proof; refresh the affected product docs.

## Stop Conditions

Pause for human confirmation if:

- Masking would break an existing log consumer that keys on the exact `path`.
- The multipart API does not expose bytes without fully buffering (interaction with the
  US-024 body-size limit needs coordinating).
- A legitimate accepted image format is not covered by the signature table (would falsely
  reject uploads).
