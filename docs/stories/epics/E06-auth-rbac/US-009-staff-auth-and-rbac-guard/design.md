# Design — US-009 Staff Auth & RBAC Guard

## Domain Model

- `User` (id, restaurantId, email, passwordHash, name, role, isActive).
- `RefreshToken` (id, userId, tokenHash, expiresAt, revoked, createdAt).
- Value objects: `AccessTokenClaims { userId, role, restaurantId, exp }`,
  `Role = ADMIN | KITCHEN | CASHIER`.
- Domain services (interfaces in `domain/`): `PasswordHasher`, `TokenService`
  (sign/verify access), `RefreshTokenStore`.

## Application Flow

- `LoginUseCase(email, password)` → verify active user + password → issue access token
  + create refresh token row → return both.
- `RefreshUseCase(refreshToken)` → hash + look up → assert not revoked/expired → issue
  new access token (optionally rotate refresh token).
- `LogoutUseCase(refreshToken)` → mark matching row `revoked = true` (idempotent).
- `MeUseCase(claims)` → return current user profile.

## Interface Contract

Routes (see `auth-authorization.md`):

| Method | Path | Auth | Body / result |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | none | `{ email, password }` → `{ accessToken, refreshToken, user }` |
| POST | `/api/auth/refresh` | refresh token | → `{ accessToken }` |
| POST | `/api/auth/logout` | refresh token | → `204` |
| GET | `/api/auth/me` | access token | → `{ user }` |

Errors use the standard envelope: `INVALID_CREDENTIALS` (401, generic),
`TOKEN_REVOKED` / `TOKEN_EXPIRED` (401), `FORBIDDEN` (403).

### authGuard

- Elysia plugin/derive that reads `Authorization: Bearer <jwt>`, verifies signature +
  expiry, and attaches `{ userId, role, restaurantId }` to context.
- A `requireRole(...roles)` helper guards route groups; absence/invalid → 401, wrong
  role → 403.
- Every staff repository query is filtered by the context `restaurantId`; the guard
  never trusts a `restaurantId` from the request body/query.

## Data Model

- Reuses `users` and `refresh_tokens` from US-002. No schema change expected.
- Refresh tokens stored as `tokenHash` (e.g. SHA-256 of the random value). The raw
  value is returned to the client once and never persisted.

## UI / Platform Impact

- FE stores the access token in memory and the refresh token per platform policy
  (httpOnly cookie preferred); calls `/api/auth/refresh` on 401.
- No customer-facing change.

## Observability

- Log auth outcomes without sensitive values: `auth.login.success/failure` (email
  omitted or hashed), `auth.refresh.rejected{reason}`, `auth.logout`.
- Never log passwords, raw tokens, or password hashes.

## Alternatives Considered

1. Stateless refresh (JWT refresh, no DB) — rejected; cannot revoke on logout/ban.
2. Session cookies instead of JWT access tokens — rejected; SPEC fixes JWT access +
   DB refresh in decision 0008.
3. bcrypt instead of argon2 — acceptable fallback; argon2 preferred (memory-hard).
