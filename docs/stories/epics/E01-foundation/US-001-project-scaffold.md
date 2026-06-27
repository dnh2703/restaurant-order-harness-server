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

Implemented 2026-06-27. Stack: Elysia (Bun) + Drizzle ORM on `node-postgres` (`pg`),
Clean Architecture layout (`src/{domain,application,infrastructure,presentation}`).

Toolchain added: oxlint, Prettier, Husky (`pre-commit` → lint-staged, `commit-msg` →
commitlint/conventional), TypeScript strict, `bun test`.

Driver note: `node-postgres` chosen over the HTTP serverless driver because the realtime
broker (decision 0008) needs a persistent `LISTEN/NOTIFY` connection. Drizzle pinned to
the stable line (`drizzle-orm@0.45`, `drizzle-kit@0.31`); the v1 RC the skill recommends
had config/relations typing friction at scaffold time — revisit when v1 ships.

Verified locally (and against a live Neon branch):

```text
$ bun run typecheck   # tsc --noEmit → clean
$ bun run lint        # oxlint src test → clean
$ bun run format:check# prettier → clean
$ bun test            # 1 pass (success branch, live DB)

# live Neon (DATABASE_URL set):
$ curl /api/health    → HTTP 200 {"data":{"status":"ok"}}
# negative paths:
$ curl /api/nope      → HTTP 404 {"error":{"code":"NOT_FOUND", ...}}
# dummy/unreachable DB → HTTP 503 {"error":{"code":"DB_UNAVAILABLE", ...}}
```

Proof: `--integration 1 --platform 1` (health 200 ok against live Neon; Bun boot +
Neon connect). `unit`/`e2e` n/a for scaffold.

SSL note: use `sslmode=verify-full` in `DATABASE_URL`. `sslmode=require` works but emits
a `pg` deprecation warning and will downgrade to weaker TLS in a future `pg` major.
