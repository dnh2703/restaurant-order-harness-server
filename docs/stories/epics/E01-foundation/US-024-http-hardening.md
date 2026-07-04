# US-024 HTTP hardening: security headers, body-size limit, gated API docs

## Status

planned

## Lane

normal

## Product Contract

The HTTP app sends standard security response headers, rejects oversized request
bodies before buffering them, and does not expose the OpenAPI docs/spec publicly in
production. Batches three MEDIUM findings from the 2026-07-04 security audit that all
live at the `src/presentation/http/app.ts` composition layer.

## Relevant Product Docs

- `docs/product/api-conventions.md`
- `docs/decisions/0023-auth-hardening-baseline.md` (sibling hardening context)

## Acceptance Criteria

- Responses carry `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (or an
  equivalent `Content-Security-Policy: frame-ancestors 'none'`), and, in production,
  `Strict-Transport-Security`. A restrictive CSP is applied at least to the docs page.
- A global request body-size limit is enforced by the server/framework so an oversized
  body is rejected before the whole payload is buffered into memory. The existing 5 MB
  image check remains as defense-in-depth (see US-025 for the upload path).
- `GET /api/docs` and `GET /api/docs/json` are not reachable unauthenticated in
  production: the OpenAPI plugin is mounted only when `!env.isProduction` (or placed
  behind the auth guard). Non-prod behavior is unchanged.
- No regression: full suite green; existing routes and the error envelope unchanged.

## Design Notes

- Commands: none.
- Queries: none.
- API: adds response headers globally; conditionally removes `/api/docs*` in production;
  adds a `413`-style rejection for oversized bodies (exact code per framework behavior).
- Tables: none.
- Domain rules: none — this is transport/infra hardening at `app.ts` and plugins
  (`openapi.ts`).
- UI surfaces: none directly; the FE must tolerate the docs endpoints being absent in
  prod (it should not depend on them).

## Validation

`scripts/bin/harness-cli story update --id US-024 --unit 0 --integration 1 --e2e 0 --platform 1`

| Layer | Expected proof |
| --- | --- |
| Unit | header plugin sets the expected headers on a sample response |
| Integration | a response carries the security headers; `/api/docs` returns 404 under `env.isProduction`, 200 otherwise; an oversized body is rejected before handler runs |
| E2E | |
| Platform | headers present on a real boot; docs gated by NODE_ENV |
| Release | |

## Harness Delta

Batched intake of three MEDIUM audit findings into one normal story. No new decision
record (no meaningful auth/data/contract-ownership change; docs-gating is a config
change).

## Evidence

Add after implementation.
