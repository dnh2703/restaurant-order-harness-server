# Design — CI + API Docs (OpenAPI)

Date: 2026-06-27
Branch: `chore/ci-and-openapi` (from `main`, after US-002 merged)

## Goal

Add continuous integration (GitHub Actions) and self-serve API documentation
(`@elysiajs/openapi`) to the Restaurant QR server. Deployment/CD is explicitly
deferred until the app has real endpoints and a host is chosen.

## Non-Goals (deferred)

- CD / deployment to any host (Fly/Koyeb/Render/Vercel decision postponed).
- Integration tests in CI against a live Neon branch (per-PR branch provisioning).
- Branch protection / required-checks configuration.

## 1. CI — GitHub Actions

**File:** `.github/workflows/ci.yml`

- **Triggers:** `pull_request` and `push` to `main`.
- **Concurrency:** cancel in-progress runs for the same ref.
- **Runner:** `ubuntu-latest`.
- **Bun:** `oven-sh/setup-bun@v2`, pinned `bun-version: 1.3.13` (matches local dev).
- **Steps:**
  1. `bun install --frozen-lockfile`
  2. `bun run typecheck`
  3. `bun run lint`
  4. `bun run format:check`
  5. `bun run test`

### Test strategy in CI (Approach B — approved)

`src/infrastructure/config/env.ts` calls `required('DATABASE_URL')` at module load,
so any test importing the app/db throws without that variable — it cannot merely skip.
CI therefore sets a **dummy, non-secret** value:

```yaml
env:
  DATABASE_URL: postgresql://ci:ci@localhost:5432/ci
```

The full `bun test` then runs deterministically with no secrets and no real database:

| Test file | Behavior in CI |
| --- | --- |
| `schema.test.ts` | passes (pure, DB-free) |
| `seed.test.ts` | passes (pure `buildSeedData`) |
| `health.test.ts` | DB unreachable → route returns **503**; test asserts the documented `DB_UNAVAILABLE` error envelope → passes (also proves the 503 path) |
| `orders-invariant.test.ts` | `schemaReady()` connection fails → **self-skips** |
| `openapi.test.ts` (new) | passes (OpenAPI endpoint never touches the DB) |

The dummy host (`localhost:5432`, nothing listening) fails with `ECONNREFUSED`
immediately, so there are no hangs. Real integration proof stays on Neon branches,
out of CI.

## 2. API Docs — `@elysiajs/openapi`

Use **`@elysiajs/openapi`** (the current plugin; successor to `@elysiajs/swagger`).
Add it as a runtime dependency.

- **New file** `src/presentation/http/plugins/openapi.ts` encapsulates the plugin config
  (mirrors the existing `plugins/error-handler.ts` boundary). It reads the API title and
  `version` from `package.json`.
- `app.ts` composes it: `.use(openapiPlugin)`.
- Docs live under the `/api` prefix at **`/api/docs`** (UI) with the OpenAPI JSON at the
  plugin's JSON path (e.g. `/api/docs/json`). Exact option names verified against the
  Elysia `plugins/openapi.md` reference during implementation.
- `routes/health.ts` gains a `response` schema for `200` and a `Health` tag so the
  generated spec is meaningful. This is a small, in-scope annotation, not a behavior
  change.

## 3. Test for OpenAPI

**New file** `test/openapi.test.ts`, DB-free:

1. Ensure `process.env.DATABASE_URL` is set to a dummy value, then dynamically
   `import('../src/presentation/http/app')` (env is read at import time).
2. `GET /api/docs/json` (the OpenAPI document) returns 200.
3. Assert the document includes the `/api/health` path and the API title.

The OpenAPI endpoint does not connect to the database, so this runs in CI under
Approach B without a real DB.

## 4. Optional ADR

`docs/decisions/0009-ci-and-api-docs.md` records: GitHub Actions for CI, DB-free test
gate (Approach B), `@elysiajs/openapi` for docs, and deployment deferred. Keeps the
durable decision trail consistent with decisions 0001–0008.

## Files

| File | Change |
| --- | --- |
| `.github/workflows/ci.yml` | new — CI workflow |
| `src/presentation/http/plugins/openapi.ts` | new — OpenAPI plugin config |
| `src/presentation/http/app.ts` | mount the OpenAPI plugin |
| `src/presentation/http/routes/health.ts` | add `200` response schema + `Health` tag |
| `test/openapi.test.ts` | new — OpenAPI doc test |
| `package.json` | add `@elysiajs/openapi` dependency |
| `docs/decisions/0009-ci-and-api-docs.md` | new — ADR |

## Verification

- `bun install`, `bun run typecheck`, `bun run lint`, `bun run format:check`,
  `bun test` all green locally.
- Push the branch, open a PR, and confirm the CI workflow runs and passes on the PR.
- Manually open `/api/docs` against a locally running app to confirm the UI renders.
