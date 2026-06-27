# Auth & Authorization

Covers EPIC 8. Built in-house on the backend. **High-risk domain** — auth and
authorization are hard gates; behavior changes require a decision record.

## Identity

- Only staff (`ADMIN`, `KITCHEN`, `CASHIER`) authenticate. Customers never log in;
  they are authorized by table `qr_token` only.
- Passwords hashed with argon2 (preferred) or bcrypt. Never store or log plaintext.

## Tokens

| Token | Lifetime | Storage | Contains |
| --- | --- | --- | --- |
| Access (JWT) | ~15 min | stateless, not stored | `userId`, `role`, `restaurantId`, `exp` |
| Refresh | ~7–30 days | DB `refresh_tokens`, hashed, revocable | opaque |

- Access tokens are signed with `@elysiajs/jwt`. Verified on every staff request.
- Refresh tokens are stored as `token_hash` so a DB leak does not expose usable
  tokens.

## Endpoints

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | none | email + password → access + refresh token |
| POST | `/api/auth/refresh` | refresh token | issue new access token; revoked → 401 |
| POST | `/api/auth/logout` | refresh token | mark refresh token `revoked = true` |
| GET | `/api/auth/me` | access token | current user profile + role |

### Login (US-8.1)

- Verify email is active (`is_active = true`) and password matches the hash.
- On success return access token + refresh token; record the refresh token row.
- Invalid credentials → `401 INVALID_CREDENTIALS` (do not reveal which field failed).

### Refresh (US-8.2)

- Look up the presented refresh token by hash; reject if missing, expired, or
  `revoked`. Return `401 TOKEN_REVOKED` / `TOKEN_EXPIRED`.
- Optionally rotate the refresh token (revoke old, issue new) — decision deferred.

### Logout (US-8.3)

- Revoke the corresponding refresh token. Idempotent: revoking an already-revoked
  token still returns success.

## Authorization (RBAC)

`authGuard` middleware verifies the JWT, attaches `{ userId, role, restaurantId }` to
context, and enforces role per route group:

| Role | Allowed surfaces |
| --- | --- |
| `ADMIN` | full: menu/table/staff CRUD, reports, all staff screens |
| `KITCHEN` | kitchen board + item status only |
| `CASHIER` | cashier/billing + service requests only |

- Wrong role → `403 FORBIDDEN`. Missing/invalid token → `401`.
- Tenant scope: every staff query is filtered by `restaurantId` from the token; a
  user may never read or mutate another restaurant's data.
- Customer (QR) routes skip the guard entirely and are authorized by `qr_token`.

## Staff Account Management (US-8.4)

- `ADMIN` can CRUD staff accounts and assign roles within their restaurant.
- Deactivating a user (`is_active = false`) revokes all their refresh tokens.

## Validation Shape

| Layer | Proof |
| --- | --- |
| Unit | password hashing/verify, JWT sign/verify, refresh-token hashing, guard role logic |
| Integration | login → refresh → logout flow against DB; revoked token rejected |
| E2E | staff logs in, reaches only the allowed screen, is blocked from others |
