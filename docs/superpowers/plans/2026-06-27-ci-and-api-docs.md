# CI + API Docs (OpenAPI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions CI pipeline and self-serve OpenAPI documentation to the Elysia/Bun server, with deployment deferred.

**Architecture:** A single CI workflow runs the existing quality scripts (typecheck, lint, format check, tests) on PRs and pushes to `main`, using a dummy non-secret `DATABASE_URL` so the full `bun test` suite runs without a real database. API docs come from the `@elysiajs/openapi` plugin, encapsulated in its own presentation plugin module and mounted on the `/api` app.

**Tech Stack:** Bun, Elysia 1.4, `@elysiajs/openapi`, GitHub Actions, oxlint, prettier, TypeBox.

## Global Constraints

- Runtime: Bun `>=1.3.0`; CI pins Bun `1.3.13` (matches local dev).
- Commits: Conventional Commits (enforced by commitlint via husky `commit-msg`).
- Every commit must pass the husky `pre-commit` hook: `oxlint` and `prettier` clean.
- HTTP base path is `/api`; error envelope is `{ "error": { "code", "message", "details"? } }` (see `docs/product/api-conventions.md`).
- No secrets in CI. The only DB config is a dummy, unreachable `DATABASE_URL: postgresql://ci:ci@localhost:5432/ci`.
- API docs use **`@elysiajs/openapi`** (successor to `@elysiajs/swagger`). The plugin's default docs path is `/openapi`; mounted under the `/api` app it serves UI at `/api/openapi` and JSON at `/api/openapi/json`.
- Deployment/CD is out of scope.

## File Structure

| File | Responsibility |
| --- | --- |
| `.github/workflows/ci.yml` | CI workflow: install + typecheck + lint + format check + test |
| `src/presentation/http/plugins/openapi.ts` | OpenAPI plugin configuration (title/version/tags) |
| `src/presentation/http/app.ts` | Compose the OpenAPI plugin onto the app |
| `src/presentation/http/routes/health.ts` | Annotate the route with a 200 response schema + `Health` tag |
| `test/openapi.test.ts` | Assert the OpenAPI document is served and includes the health route |
| `package.json` / `bun.lock` | Add `@elysiajs/openapi` dependency |
| `docs/decisions/0009-ci-and-api-docs.md` | ADR recording CI + OpenAPI + deferred deploy |
| `docs/decisions/README.md` | Add 0009 to the decision index |

---

### Task 1: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: existing package.json scripts `typecheck`, `lint`, `format:check`, `test`.
- Produces: a CI pipeline; no code interfaces.

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    env:
      # Dummy, unreachable DB so env.ts (which requires DATABASE_URL at import)
      # loads. The suite stays DB-free: health hits its 503 branch, the orders
      # invariant test self-skips. No secrets needed.
      DATABASE_URL: postgresql://ci:ci@localhost:5432/ci
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.13
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run lint
      - run: bun run format:check
      - run: bun run test
```

- [ ] **Step 2: Format and verify the workflow's commands pass locally**

The workflow only runs commands that already exist. Reproduce the CI environment locally
(dummy DB) to confirm the full suite is green without a real database:

Run:
```bash
bun run format        # ensure ci.yml is prettier-clean
bun run typecheck && bun run lint && bun run format:check
DATABASE_URL='postgresql://ci:ci@localhost:5432/ci' bun run test
```
Expected: typecheck/lint/format:check clean; `bun test` passes — schema/seed unit tests
pass, `health` test passes via the 503 branch, `orders-invariant` self-skips.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for typecheck, lint, format, and tests"
```

(CI itself is verified at the end of the plan by pushing the branch and opening a PR.)

---

### Task 2: OpenAPI docs plugin

**Files:**
- Create: `src/presentation/http/plugins/openapi.ts`
- Modify: `src/presentation/http/app.ts`
- Modify: `src/presentation/http/routes/health.ts`
- Test: `test/openapi.test.ts`
- Modify: `package.json`, `bun.lock` (via `bun add`)

**Interfaces:**
- Produces: `openapiPlugin` — an Elysia plugin instance exported from
  `src/presentation/http/plugins/openapi.ts`, consumed by `app.ts` via `.use(openapiPlugin)`.

- [ ] **Step 1: Write the failing test**

Create `test/openapi.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'

// env.ts requires DATABASE_URL at import time; set a dummy before importing the app.
// The OpenAPI endpoint never connects to the database, so no real DB is needed.
process.env.DATABASE_URL ??= 'postgresql://ci:ci@localhost:5432/ci'
const { app } = await import('../src/presentation/http/app')

describe('OpenAPI docs', () => {
  it('serves an OpenAPI document that includes the health route', async () => {
    const res = await app.handle(new Request('http://localhost/api/openapi/json'))
    expect(res.status).toBe(200)

    const spec = (await res.json()) as {
      info: { title: string }
      paths: Record<string, unknown>
    }
    expect(spec.info.title).toBe('Restaurant QR Ordering API')
    expect(Object.keys(spec.paths).some((path) => path.includes('/health'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/openapi.test.ts`
Expected: FAIL — `/api/openapi/json` is not mounted yet, so `res.status` is 404 (not 200).

- [ ] **Step 3: Add the dependency**

Run: `bun add @elysiajs/openapi`
Expected: `package.json` gains `@elysiajs/openapi` under dependencies; `bun.lock` updates.

- [ ] **Step 4: Create the OpenAPI plugin module**

Create `src/presentation/http/plugins/openapi.ts`:

```typescript
import { openapi } from '@elysiajs/openapi'

import pkg from '../../../../package.json'

/**
 * OpenAPI documentation for the HTTP API. Mounted on the /api app, so the UI is served
 * at /api/openapi and the spec JSON at /api/openapi/json. Route-level shapes (request,
 * response, tags) are derived from each route's Elysia schema + `detail`.
 * See docs/product/api-conventions.md.
 */
export const openapiPlugin = openapi({
  documentation: {
    info: {
      title: 'Restaurant QR Ordering API',
      version: pkg.version,
      description: 'Backend API for the Restaurant QR ordering system.',
    },
    tags: [{ name: 'Health', description: 'Liveness and database readiness checks.' }],
  },
})
```

- [ ] **Step 5: Mount the plugin on the app**

Modify `src/presentation/http/app.ts` — add the import and compose the plugin:

```typescript
import { Elysia } from 'elysia'

import { errorHandler } from './plugins/error-handler'
import { openapiPlugin } from './plugins/openapi'
import { healthRoutes } from './routes/health'

/**
 * HTTP application composition root. All routes are mounted under /api
 * (see docs/product/api-conventions.md). Exported without `.listen()` so tests can
 * drive it via `app.handle(...)`; src/index.ts owns the actual listen.
 */
export const app = new Elysia({ prefix: '/api' })
  .use(errorHandler)
  .use(openapiPlugin)
  .use(healthRoutes)

export type App = typeof app
```

- [ ] **Step 6: Annotate the health route for a richer spec**

Modify `src/presentation/http/routes/health.ts` — import `t`, add `response` + `detail`:

```typescript
import { Elysia, t } from 'elysia'

import { checkDatabase } from '../../../infrastructure/database/health'
import { AppError } from '../../../shared/errors'

/**
 * GET /api/health — liveness + database connectivity smoke endpoint.
 * 200 { data: { status: 'ok' } } when the DB round-trips; otherwise the global error
 * handler turns the thrown AppError into 503 { error: { code: 'DB_UNAVAILABLE' } }.
 */
export const healthRoutes = new Elysia().get(
  '/health',
  async () => {
    try {
      await checkDatabase()
    } catch {
      throw new AppError('DB_UNAVAILABLE')
    }

    return { data: { status: 'ok' as const } }
  },
  {
    detail: {
      tags: ['Health'],
      summary: 'Liveness and database connectivity check',
    },
    response: {
      200: t.Object({ data: t.Object({ status: t.Literal('ok') }) }),
    },
  },
)
```

- [ ] **Step 7: Run the OpenAPI test to verify it passes**

Run: `bun test test/openapi.test.ts`
Expected: PASS — `/api/openapi/json` returns 200, the title matches, and a `/health`
path is present.

- [ ] **Step 8: Run the full suite + quality gates**

Run:
```bash
bun run format
bun run typecheck && bun run lint && bun run format:check
bun test
```
Expected: all green. The existing `health.test.ts` still passes (the added 200 response
schema matches the returned shape). With a real `DATABASE_URL` in `.env`, `health`
returns 200; `orders-invariant` runs only if the schema is migrated, otherwise self-skips.

- [ ] **Step 9: Commit**

```bash
git add package.json bun.lock src/presentation/http/plugins/openapi.ts \
  src/presentation/http/app.ts src/presentation/http/routes/health.ts test/openapi.test.ts
git commit -m "feat: serve OpenAPI docs via @elysiajs/openapi"
```

---

### Task 3: ADR + decision index

**Files:**
- Create: `docs/decisions/0009-ci-and-api-docs.md`
- Modify: `docs/decisions/README.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Write the ADR**

Create `docs/decisions/0009-ci-and-api-docs.md`:

```markdown
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
```

- [ ] **Step 2: Add 0009 to the decision index**

Modify `docs/decisions/README.md`: add a list entry for `0009-ci-and-api-docs.md`
following the existing format used for entries 0001–0008 (match the surrounding style and
ordering exactly — read the file first).

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0009-ci-and-api-docs.md docs/decisions/README.md
git commit -m "docs: add ADR 0009 for CI pipeline and API docs"
```

---

### Task 4: Verify CI on a pull request

**Files:** none (verification only).

- [ ] **Step 1: Push the branch**

Run: `git push -u origin chore/ci-and-openapi`

- [ ] **Step 2: Open a pull request**

Run:
```bash
gh pr create --base main --head chore/ci-and-openapi \
  --title "chore: add CI pipeline and OpenAPI docs" \
  --body "Adds GitHub Actions CI (typecheck/lint/format/test, DB-free) and @elysiajs/openapi docs at /api/openapi. Deploy deferred (see ADR 0009)."
```

- [ ] **Step 3: Confirm CI passes**

Run: `gh pr checks --watch`
Expected: the `verify` job completes successfully. If it fails, read the logs with
`gh run view --log-failed`, fix on the branch, and push again.

- [ ] **Step 4 (optional): Manually confirm the docs UI**

Run (in one shell): `bun run dev` — then open `http://localhost:3000/api/openapi` in a
browser and confirm the docs UI renders with the health route under the `Health` tag.
Stop the dev server when done.

---

## Self-Review

- **Spec coverage:** CI workflow (Task 1) ✓; Approach-B dummy DB (Task 1 env) ✓;
  `@elysiajs/openapi` plugin module + mount + health annotation (Task 2) ✓; DB-free
  OpenAPI test (Task 2) ✓; ADR 0009 (Task 3) ✓; deploy deferred (ADR) ✓; CI verified on
  a PR (Task 4) ✓.
- **Placeholder scan:** none — all steps carry exact file contents or commands. The only
  "read the file first" is for the decision-index entry, whose format must match existing
  rows; this is a deliberate style-match instruction, not a missing detail.
- **Type consistency:** `openapiPlugin` is defined in Task 2 Step 4 and consumed in Step 5
  under the same name. The OpenAPI JSON path `/api/openapi/json` and title
  `Restaurant QR Ordering API` are consistent between the plugin config and the test.
