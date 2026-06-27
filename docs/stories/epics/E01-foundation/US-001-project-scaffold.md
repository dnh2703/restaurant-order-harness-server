# US-001 Project Scaffold + Neon Connection + Health

## Status

planned

## Lane

tiny

## Product Contract

Stand up the Elysia (Bun) backend in Clean Architecture layout, open a Neon Postgres
connection via Drizzle, and expose a health endpoint. No domain schema, CRUD, auth, or
business behavior yet — this is scaffolding and a smoke endpoint only.

## Relevant Product Docs

- `docs/product/overview.md`
- `docs/product/api-conventions.md`

## Acceptance Criteria

- `bun` project builds and runs an Elysia server.
- Source tree follows Clean Architecture: `domain/`, `application/`,
  `infrastructure/`, `presentation/`.
- Drizzle is configured and can connect to Neon using `DATABASE_URL` (env, not
  committed).
- `GET /api/health` returns `200 { "data": { "status": "ok" } }` and verifies DB
  connectivity (e.g. `SELECT 1`).

## Design Notes

- Commands: none.
- Queries: `SELECT 1` connectivity probe.
- API: `GET /api/health`.
- Tables: none.
- Domain rules: none.
- UI surfaces: none.

## Validation

`scripts/bin/harness-cli story update --id US-001 --unit 0 --integration 1 --e2e 0 --platform 1`

| Layer | Expected proof |
| --- | --- |
| Unit | n/a (scaffold) |
| Integration | health endpoint returns ok with live DB connection |
| E2E | n/a |
| Platform | server boots on Bun; connects to Neon branch |
| Release | n/a |

## Harness Delta

Introduces the app stack. When the build exists, set a story `--verify` command
(e.g. `bun test` once tests are added) and add the `validate:quick` ladder rung.

## Evidence

Add after implementation: boot log + `curl /api/health` output.
