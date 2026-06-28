# 0011 Last-Admin Protection

Date: 2026-06-28

## Status

Accepted

## Context

US-010 lets an `ADMIN` manage staff within their restaurant: create users, change roles,
and activate/deactivate accounts. Two of these actions can remove administrative access:
demoting an admin to a non-admin role, and deactivating an admin. If applied to the only
remaining active admin, the restaurant would be left with no one able to manage staff —
an irreversible self-lockout (no self-service recovery exists in this story).

US-010's exec plan flags this as a stop condition ("can an admin demote the last
admin?"). Because it changes authorization behavior (a hard gate), the resolution is
recorded here.

## Decision

Refuse any staff change that would leave a restaurant with zero active admins.

- Demoting a user whose current role is `ADMIN` and who is currently active, to a
  non-`ADMIN` role, is rejected with `409 LAST_ADMIN` unless at least one *other* active
  admin exists in the same restaurant.
- Deactivating (`is_active = false`) a currently-active `ADMIN` is rejected with
  `409 LAST_ADMIN` under the same condition.
- "Another active admin" = a different `users` row in the same `restaurantId` with
  `role = 'ADMIN'` and `is_active = true`.

The check is a single scoped existence query (`hasOtherActiveAdmin`) run before the
mutating write, consistent with the app's autocommit / Neon PgBouncer constraints.

## Alternatives Considered

1. No protection — allow the lockout and rely on manual DB intervention to recover.
   Rejected: a routine admin action could brick staff administration for a tenant.
2. Block only self-demotion / self-deactivation (an admin acting on their own account).
   Rejected as insufficient: admin A could still demote admin B down to the last admin
   and then have B locked out; the invariant we care about is "≥ 1 active admin per
   restaurant", not "you can't touch yourself".
3. Enforce via a DB constraint/trigger. Rejected for now: a partial-index count
   invariant is awkward to express portably, and the application-level guard is clear and
   testable. Can revisit if other paths start mutating admin status.

## Consequences

Positive:

- A restaurant always retains at least one active admin; staff administration can never
  be permanently locked out through the `/api/staff` API.
- Symmetric: protects against demotion and deactivation, self- or other-inflicted.

Tradeoffs:

- The guard reads current state before writing, so the privileged paths do an extra
  query. Negligible at staff-management volumes.
- The check is not transactional against a concurrent second demotion; two simultaneous
  "demote the last two admins" requests could in principle both pass their pre-check.
  Accepted as a low-risk race for a low-frequency admin action; the conservative failure
  (one extra admin survives) is harmless, and the dangerous failure (zero admins) needs
  an exact interleaving that staff workflows do not produce. Can tighten with a DB
  constraint later if needed.

## Follow-Up

- If concurrent admin mutations become a real concern, enforce the "≥ 1 active admin"
  invariant in the database.
