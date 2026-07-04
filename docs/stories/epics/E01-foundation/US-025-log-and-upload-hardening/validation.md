# Validation — US-025 Log & upload hardening

## Proof Strategy

Prove (a) no raw `qrToken` appears in any emitted access-log line for a QR request, and
(b) an upload whose bytes do not match its declared image type is rejected before the R2
write, while every genuine JPEG/PNG/WebP is accepted.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Path masker: `/api/qr/<token>/order` → `/api/qr/:qrToken/order`; non-QR paths pass through unchanged. Byte validator: each of JPEG/PNG/WebP signatures accepted; a `text/html` or truncated buffer labelled `image/png` rejected; empty buffer rejected. |
| Integration | Drive a QR request through the real request-logger and assert the captured log line contains `:qrToken` and NOT the actual token. Upload endpoint: a real PNG succeeds; a non-image body labelled `image/png` → 4xx `IMAGE_*`; existing MIME/size rejections still hold. |
| E2E | Existing QR order flow and dish-image upload happy paths still pass. |
| Platform | Manual: hit a QR route on a real boot and confirm the token is masked in stdout logs. |
| Performance | Byte check reads only the leading bytes (not the whole file twice); negligible. |
| Logs/Audit | The access-log assertion above IS the audit proof; also confirm no token in error logs. |

## Fixtures

- A known `qrToken` from the seed to drive the QR request and grep the log line for it.
- Small binary fixtures: a valid PNG, a valid JPEG, a valid WebP, and a non-image buffer
  (e.g. `<html>`) — all built inline so no external files are needed.

## Commands

```text
bun test test/logging          # log masking
bun test test/menu-items       # or the upload test file — byte validation
bun test                       # full suite green
bun run typecheck && bun run lint
```

## Acceptance Evidence

Add results after verification.
