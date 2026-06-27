# Exec Plan — US-010 Staff Account & Role Administration

## Goal

Let an `ADMIN` manage staff accounts and roles within their restaurant: create staff,
update name/role/active state, and deactivate. Deactivating a user revokes their refresh
tokens. Implements SPEC US-8.4 (account/role management half).

## Scope

In scope:

- `GET/POST/PATCH /api/staff` (+ deactivate) under `ADMIN` role.
- Create staff with email + initial password (hashed), name, role.
- Update name/role; toggle `is_active`.
- Deactivating (`is_active = false`) revokes all of that user's refresh tokens.

Out of scope:

- Login/refresh/logout and the guard itself (US-009).
- Self-service password reset / email invites.
- Cross-restaurant or super-admin management.

## Risk Classification

Risk flags:

- Authorization (assigning roles grants access).
- Data model (`users` writes, `refresh_tokens` revocation).
- Audit/security (account lifecycle, privileged action).
- Public contracts (`/api/staff` shape).

Hard gates:

- Authorization.

## Work Phases

1. Discovery — confirm guard + role model from US-009.
2. Design — staff CRUD use-cases, role-change + deactivation side effects.
3. Validation planning — unit (validation, revoke-on-deactivate), integration (CRUD +
   tenant scope), E2E (admin manages a user).
4. Implementation — smallest slice: create + list staff, then update/deactivate.
5. Verification — against a Neon test branch with seeded admin.
6. Harness update — set story `--verify` and proof booleans.

## Stop Conditions

Pause for human confirmation if:

- An admin could be allowed to change another restaurant's users (must be impossible).
- Role escalation rules need policy (e.g. can an admin demote the last admin?).
- Deactivation must not actually revoke tokens (would weaken security).
