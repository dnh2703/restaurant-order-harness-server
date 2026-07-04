# Validation — US-022 Fail-fast on missing JWT secret outside tests

## Proof Strategy

Prove that (a) the dev fallback is reachable only under `NODE_ENV === 'test'`, (b) any
other environment without `AUTH_JWT_SECRET` fails fast, and (c) a supplied secret is used
verbatim. The existing auth suite must stay green (tests run without setting the secret).

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | `authJwtSecret()`: `NODE_ENV=test` + unset → dev fallback; `test` + set → the set value; `production` + unset → throws; `staging`/unset `NODE_ENV` + unset → throws; any env + set → the set value. |
| Integration | App boot smoke: non-test env without `AUTH_JWT_SECRET` → startup throws, port not bound; with the var → boots and `POST /api/auth/login` issues a verifiable token. |
| E2E | Existing auth E2E (login → /me → refresh) still passes under the test env. |
| Platform | Deploy note verified: `.env.example` lists `AUTH_JWT_SECRET` as required outside tests. |
| Performance | n/a (startup-only check). |
| Logs/Audit | Confirm the secret value never appears in startup logs or error output. |

## Fixtures

- No DB fixtures. Env matrix is driven by setting `NODE_ENV` / `AUTH_JWT_SECRET` per case.
- Since `env.ts` reads `process.env` once at module load, unit tests must exercise
  `authJwtSecret` in isolation (extract/testable) or re-import the module with a mutated
  env per case.

## Commands

```text
bun test test/config          # or the file that covers authJwtSecret
bun test                      # full suite stays green
bun run typecheck && bun run lint
```

## Acceptance Evidence

Add results after verification.
