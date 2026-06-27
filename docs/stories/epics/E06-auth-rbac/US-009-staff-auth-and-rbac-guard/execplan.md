# Exec Plan — US-009 Staff Auth & RBAC Guard

## Goal

Deliver the full staff authentication + authorization mechanism: email/password login
issuing a short-lived JWT access token and a DB-stored revocable refresh token; refresh
and logout; and an `authGuard` that verifies the access token and enforces role +
tenant scope on staff routes. Implements SPEC US-8.1, US-8.2, US-8.3, and the `authGuard`
half of US-8.4.

## Scope

In scope:

- `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`,
  `GET /api/auth/me`.
- Password hashing (argon2) + verification.
- JWT access token (`userId`, `role`, `restaurantId`, ~15 min) via `@elysiajs/jwt`.
- Refresh token: random opaque value, stored hashed in `refresh_tokens`, revocable.
- `authGuard` middleware: verify access token, attach `{ userId, role, restaurantId }`,
  enforce required role(s) per route group and `restaurantId` tenant scope.

Out of scope:

- Staff account CRUD / role assignment UI (US-010).
- Customer (QR) routes — they remain unauthenticated and skip the guard.
- Password reset / email flows.

## Risk Classification

Risk flags:

- Auth (login, sessions, JWT, password, refresh token).
- Authorization (role + tenant enforcement).
- Data model (`refresh_tokens` writes/revocation).
- Audit/security (credential handling, token storage).
- Public contracts (`/api/auth/*` shape + `Authorization` header).

Hard gates:

- Auth.
- Authorization.

## Work Phases

1. Discovery — confirm `users` / `refresh_tokens` schema (US-002) and
   `auth-authorization.md` contract.
2. Design — token lifecycle, hashing params, guard composition in Elysia.
3. Validation planning — unit (hash, sign/verify, guard logic), integration
   (login→refresh→logout, revoked token rejected), E2E (role reaches only allowed
   screen).
4. Implementation — smallest vertical slice: login → guarded `GET /api/auth/me`.
5. Verification — run the auth flow against a Neon test branch.
6. Harness update — set story `--verify`; add `validate:quick` auth tests.

## Stop Conditions

Pause for human confirmation if:

- Refresh-token rotation policy must be chosen (rotate-on-refresh vs fixed lifetime) —
  open decision from 0008; recommend rotate-on-refresh with reuse detection.
- Tenant scoping must change the authorization model.
- Any requirement would weaken credential or token-storage security.
