# 0010 Refresh Token Rotation & Reuse Detection

Date: 2026-06-28

## Status

Accepted

## Context

Decision 0008 fixed the auth model (JWT access token + DB-stored revocable refresh
token) but deferred the refresh-token rotation policy. US-009 implements
`POST /api/auth/refresh` and must resolve it. Auth/authorization are hard gates, so this
behavior choice requires a decision record.

The open question: when a refresh token is exchanged for a new access token, does the
refresh token stay the same for its whole lifetime, or is it rotated (revoked and
replaced) on every use?

## Decision

Rotate on every refresh, with reuse detection.

- Each successful `POST /api/auth/refresh` revokes the presented refresh token and issues
  a brand-new one alongside the new access token.
- If a refresh token that was already rotated away (now `revoked`) is presented again,
  this is treated as a compromise signal — the legitimate client and an attacker cannot
  both hold the latest token. The server revokes **all** of that user's refresh tokens
  (the whole session family) and rejects with `401 TOKEN_REVOKED`.
- Reuse detection is implemented without a schema change: detection keys off the existing
  `refresh_tokens.revoked` flag, and family revocation is a single
  `UPDATE refresh_tokens SET revoked = true WHERE user_id = $1`. No token-lineage column
  is added.

## Alternatives Considered

1. Fixed-lifetime refresh token (no rotation). Simpler, fewer writes, but a leaked
   refresh token is usable for its full lifetime with no way to detect theft. Rejected.
2. Rotation with an explicit token-family / `replaced_by` lineage column. Enables
   precise family tracking but requires a schema migration that US-009's design
   explicitly avoids. Deferred — the `revoked`-flag approach already revokes the family.

## Consequences

Positive:

- A stolen refresh token is detected the moment either party refreshes, and the theft
  revokes every live session for that user.
- No schema change; stays within US-002's `refresh_tokens` shape.
- Statements run in autocommit (no multi-statement transaction), consistent with the
  app's Neon PgBouncer transaction-pooling constraints.

Tradeoffs:

- Family revocation is coarse: any reuse nukes all of the user's sessions, not just the
  compromised lineage. Acceptable for staff accounts; the conservative, fail-safe side.
- Rotation + revoke + insert across `/refresh` are separate autocommit statements; a
  crash mid-rotation leaves the old token revoked and no replacement issued, forcing a
  re-login. Safe failure mode.
- A client must always store the newest refresh token; a stale retry of an
  already-rotated token is rejected as reuse.

## Follow-Up

- If precise lineage is needed later, add a `refresh_tokens` family/`replaced_by` column
  and narrow family revocation to the affected lineage.
