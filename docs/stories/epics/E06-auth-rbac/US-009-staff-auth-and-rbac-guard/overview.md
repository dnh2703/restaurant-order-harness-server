# Overview — US-009 Staff Auth & RBAC Guard

## Current Behavior

After E01–E05 the customer ordering loop works with no authentication. There is a
`users` and `refresh_tokens` table (US-002) but no login, token issuance, or route
protection. Every endpoint is effectively open.

## Target Behavior

Staff authenticate with email + password and receive a JWT access token plus a
revocable refresh token. Protected staff routes require a valid access token and the
correct role; cross-restaurant access is impossible.

- Login verifies an active user and returns access + refresh tokens.
- Refresh exchanges a valid (non-revoked, non-expired) refresh token for a new access
  token; revoked/expired → 401.
- Logout revokes the presented refresh token (idempotent).
- `authGuard` verifies the access token, attaches identity, and enforces role + tenant
  scope; wrong role → 403, missing/invalid token → 401.
- Customer QR routes are explicitly exempt from the guard.

## Affected Users

- `ADMIN`, `KITCHEN`, `CASHIER` — gain authenticated sessions.
- Customer — unaffected (no auth).

## Affected Product Docs

- `docs/product/auth-authorization.md` (source of truth)
- `docs/product/api-conventions.md` (auth header, error envelope)
- `docs/product/data-model.md` (`users`, `refresh_tokens`)

## Non-Goals

- Staff account creation / role management (US-010).
- Token rotation UX, password reset, MFA.
- Applying the guard to feature routes that do not exist yet (kitchen/cashier come with
  E07/E08).
