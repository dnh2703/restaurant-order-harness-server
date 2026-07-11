# US-027 Enforce encrypted Postgres connections outside tests

## Status

planned

## Lane

normal

## Product Contract

Outside `NODE_ENV=test`, the process refuses to boot the DB pool unless `DATABASE_URL`
requests an encrypted connection (`sslmode=require`, `verify-ca`, or `verify-full`). A
`DATABASE_URL` missing `sslmode` or set to `disable`/`allow` fails fast at startup, mirroring
the US-022 pattern for `AUTH_JWT_SECRET`.

## Relevant Product Docs

- `docs/product/data-model.md`
- `.env.example` (already recommends `sslmode=verify-full` in a comment; this story makes it
  enforced, not advisory)

## Acceptance Criteria

- Outside `NODE_ENV=test`, if `DATABASE_URL`'s `sslmode` query parameter is missing, `disable`,
  or `allow`, module load throws a clear error before `Pool`/`drizzle` are constructed (no
  silent unencrypted connection).
- `NODE_ENV=test` is unaffected: CI's dummy `postgresql://ci:ci@localhost:5432/ci` (no
  `sslmode`, never actually connected to) keeps booting so `env.ts` can still load and the
  test suite's self-skipping DB tests keep working.
- `sslmode=require`, `verify-ca`, and `verify-full` are all accepted (this story enforces
  *encryption*, not certificate verification level — that stays an operator choice, though
  `.env.example` already recommends `verify-full`).
- No regression: full suite green; local dev against a real Neon pooled connection (which
  already uses `verify-full`) is unaffected.

## Design Notes

- Commands: none.
- Queries: none.
- API: none (startup-only check).
- Tables: none.
- Domain rules: none — configuration-validation invariant, same shape as US-022's
  `authJwtSecret()` fail-fast.
- UI surfaces: none.
- Implementation sketch (`src/infrastructure/config/env.ts`): add a check alongside
  `databaseUrl: required('DATABASE_URL')` that parses the `sslmode` query parameter and throws
  when it is absent or one of `disable`/`allow`, gated on `nodeEnv !== 'test'` (same guard
  shape as `authJwtSecret()`).

## Validation

`scripts/bin/harness-cli story update --id US-027 --unit 1 --integration 0 --e2e 0 --platform 1`

| Layer | Expected proof |
| --- | --- |
| Unit | sslmode check: `test` env + no sslmode → passes; `production`/unset/other env + no `sslmode`/`disable`/`allow` → throws; `production` + `require`/`verify-ca`/`verify-full` → passes |
| Integration | |
| E2E | |
| Platform | boot smoke: non-test env with an unencrypted `DATABASE_URL` → startup throws; with `sslmode=verify-full` → boots |
| Release | |

## Harness Delta

No new decision — configuration-validation tightening at the same layer/shape as US-022, not
a hard gate (touches External systems + Existing behavior only; see decision 0025 follow-up).

## Evidence

Add after implementation.
