# Design — US-010 Staff Account & Role Administration

## Domain Model

- Reuses `User` and `RefreshToken` from US-009.
- Invariants:
  - Email is unique per system (DB unique constraint).
  - A user always belongs to exactly one `restaurantId` (the admin's).
  - Role ∈ `ADMIN | KITCHEN | CASHIER`.

## Application Flow

- `ListStaffUseCase(restaurantId)` → users in that restaurant.
- `CreateStaffUseCase(restaurantId, {email, password, name, role})` → hash password →
  insert user.
- `UpdateStaffUseCase(restaurantId, userId, {name?, role?})` → tenant-checked update.
- `SetStaffActiveUseCase(restaurantId, userId, isActive)` → update flag; when disabling,
  revoke all refresh tokens for that user in the same transaction.

All use-cases take `restaurantId` from the authenticated admin's claims, never the
request body.

## Interface Contract

| Method | Path | Auth | Result |
| --- | --- | --- | --- |
| GET | `/api/staff` | ADMIN | list staff (no password hashes) |
| POST | `/api/staff` | ADMIN | create → `201 { user }` |
| PATCH | `/api/staff/:id` | ADMIN | update name/role |
| PATCH | `/api/staff/:id/active` | ADMIN | toggle active; disabling revokes tokens |

Errors: `409 EMAIL_TAKEN`, `404 USER_NOT_FOUND` (incl. other-restaurant ids — do not
reveal existence), `422` invalid role/email, `403` non-admin.

Responses never include `password_hash`.

## Data Model

- Writes `users`; updates `refresh_tokens.revoked` on deactivation. No schema change.
- Deactivation + token revocation run in one transaction.

## UI / Platform Impact

- Admin staff-management screen (FE, later). API contract is the deliverable here.

## Observability

- Log privileged actions: `staff.created`, `staff.role_changed{from,to}`,
  `staff.deactivated{revokedTokens:n}` — without secrets.

## Alternatives Considered

1. Hard-deleting users — rejected; breaks `payments.cashier_id` and audit history. Use
   `is_active = false` instead.
2. Letting the request specify `restaurantId` — rejected; tenant scope must come from
   the token to prevent cross-restaurant management.
3. Revoking tokens lazily (check `is_active` on refresh only) — acceptable defense in
   depth, but explicit revocation on deactivation is the primary guarantee.
