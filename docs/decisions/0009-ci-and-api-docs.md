# 0009 CI Pipeline & API Documentation

Date: 2026-06-27

## Status

Accepted

## Context

The project had quality scripts (typecheck, lint, format, tests) but no automated gate,
and no machine- or human-readable API contract surface. Decision 0008's follow-up called
for wiring a validation ladder once the toolchain existed.

## Decision

1. Run CI on GitHub Actions for every pull request and push to `main`: install, then
   `typecheck`, `lint`, `format:check`, and `test`.
2. Keep CI database-free: provide a dummy, unreachable `DATABASE_URL` so `env.ts` loads,
   the health route exercises its 503 branch, and the orders-invariant test self-skips.
   Real integration proof stays on Neon branches, out of CI.
3. Serve API documentation with `@elysiajs/openapi` (successor to `@elysiajs/swagger`),
   mounted on the `/api` app at `/api/openapi`.
4. Defer deployment/CD until the app exposes real endpoints and a host is chosen. The
   app's realtime design (a backend-held Postgres `LISTEN` broker, decision 0008) needs a
   long-running host, which rules out pure-serverless platforms for the realtime path.

## Consequences

Positive:

- Every change is gated by the same checks locally and in CI, with no secrets.
- The API has a living, browsable contract that tracks the Elysia route schemas.

Tradeoffs:

- CI proves only DB-free behavior; integration coverage depends on Neon-branch runs.
- A deploy decision (and possibly splitting the realtime broker onto an always-on host)
  is still outstanding.
