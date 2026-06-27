# Overview — US-010 Staff Account & Role Administration

## Current Behavior

After US-009 staff can authenticate and routes are guarded, but staff accounts can only
be created by the US-002 seed or manual DB inserts. An admin has no way to add a cook or
cashier, change a role, or disable an account.

## Target Behavior

An `ADMIN` manages staff within their own restaurant:

- List staff (scoped to `restaurantId`).
- Create a staff member (email, initial password, name, role).
- Update name and role; toggle active state.
- Deactivating a user sets `is_active = false` and revokes all their refresh tokens, so
  existing sessions cannot refresh.

All actions are guarded by `requireRole('ADMIN')` and tenant-scoped; an admin can never
read or mutate another restaurant's users.

## Affected Users

- `ADMIN` — gains staff management.
- `KITCHEN` / `CASHIER` — can be created, re-roled, or disabled.

## Affected Product Docs

- `docs/product/auth-authorization.md` (US-8.4 account management)
- `docs/product/data-model.md` (`users`, `refresh_tokens`)
- `docs/product/api-conventions.md`

## Non-Goals

- Authentication flows (US-009).
- Email invitations, password reset, audit-log UI.
