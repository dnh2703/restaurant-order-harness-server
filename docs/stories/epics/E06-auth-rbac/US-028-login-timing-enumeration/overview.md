# Overview — US-028 Close login timing enumeration

## Status

planned

## Current Behavior

`loginUseCase` (`src/application/auth/login.ts:33-40`) looks up the user, then short-circuits
with `INVALID_CREDENTIALS` at `!user` before ever calling `verifyPassword`. An unknown email
returns after roughly one DB lookup; a known email with a wrong password additionally pays the
full argon2id verify cost (tens of milliseconds). The response body is identical
(`INVALID_CREDENTIALS`) in both cases, but the measurable latency difference lets an attacker
enumerate valid staff emails by timing repeated login attempts, without needing any valid
credential. The existing code comment on this function already flags the gap as accepted risk.

## Target Behavior

Every login attempt performs an argon2id verify — against the real stored hash when the user
exists (and is active), or a fixed dummy hash when it doesn't — before branching to the
generic `INVALID_CREDENTIALS` error. Response body/status are unchanged for every failure
mode; only the timing gap between "unknown email" and "known email, wrong password" closes.

## Affected Users

- All staff (`ADMIN`, `KITCHEN`, `CASHIER`) — accounts become harder to enumerate via login
  timing.
- No client-visible contract change; the login endpoint's request/response shape is unchanged.

## Affected Product Docs

- `docs/product/auth-authorization.md`
- `docs/decisions/0025-low-severity-auth-and-log-hardening.md`

## Non-Goals

- Account lockout or attempt throttling — already covered by US-023 (rate limiting).
- Changing the hashing algorithm or cost parameters.
- Closing enumeration via other channels (password-reset, account-creation error messages,
  etc.) — none of those exist yet in this codebase; out of scope if/when they do.
