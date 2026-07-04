# Design — US-025 Log & upload hardening

## Domain Model

No domain entities change. Two cross-cutting invariants: "a secret path segment never
reaches the logs" and "a stored dish image is a real image by its bytes, not its label."

## Application Flow

**Access-log masking** (`src/presentation/http/plugins/request-logger.ts`): the logger's
`mapResponse`/afterHandle hook currently logs the resolved `path`. Introduce a masking step
that, before logging, replaces the token segment of known secret routes with a placeholder.
Preferred approach: match the QR route prefix (`/api/qr/<token>/...`) and rewrite the token
segment to `:qrToken`, so the log shows `/api/qr/:qrToken/order`. This keeps the route
readable and groupable without any reversible token material. (A salted hash is the
alternative if per-session correlation in logs is later required — see Alternatives.)

**Upload byte validation** (`src/application/menu-items/upload-dish-image.ts`): after the
existing MIME allow-list and size check, read the leading bytes of the file and confirm they
match the signature for the *declared* type. Reject with the existing `IMAGE_TYPE_UNSUPPORTED`
(or a new `IMAGE_BYTES_MISMATCH`) on failure, before the R2 write.

Magic-byte signatures:

- JPEG: `FF D8 FF`
- PNG: `89 50 4E 47 0D 0A 1A 0A`
- WebP: bytes 0–3 `52 49 46 46` ("RIFF") and bytes 8–11 `57 45 42 50` ("WEBP")

## Interface Contract

- No change to any success response or the log schema fields (`requestId/method/path/status/
  durationMs`) — only the *value* of `path` for QR routes is masked.
- Upload gains one rejection path: a well-formed multipart whose bytes do not match the
  declared image type → the existing 4xx image error (no new success shape).

## Data Model

No tables, indexes, or migrations.

## UI / Platform Impact

None for the FE success path. Upload clients that (incorrectly) sent mislabelled non-images
will now get a 4xx; legitimate image uploads are unaffected.

## Observability

This story *is* an observability change: QR access-log lines are sanitized. Add a test-backed
guarantee that the raw token is absent. No new metrics.

## Alternatives Considered

1. Salted-hash the token in logs instead of a static `:qrToken` template — preserves
   per-token correlation for debugging but reintroduces a (weaker) identifier and needs a
   salt secret; deferred unless log-correlation is actually needed.
2. Drop `path` from the access log entirely — loses useful non-secret routing info for every
   other endpoint; rejected.
3. Trust MIME and rely only on the bucket serving `image/*` — rejected (decision 0024): no
   server-side guarantee the object is an image; bucket becomes an arbitrary-content host.
