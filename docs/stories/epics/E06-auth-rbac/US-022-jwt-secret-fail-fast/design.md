# Design — US-022 Fail-fast on missing JWT secret outside tests

## Domain Model

No domain entities change. This is a configuration-validation invariant: "a running
service must hold a real, operator-supplied signing secret unless it is running tests."

## Application Flow

`env.ts` is evaluated once at module load. `authJwtSecret()` is the single source of the
signing key, consumed by the access-token sign and verify paths
(`src/infrastructure/auth/access-token.ts`). No request-time flow changes.

Current:

```ts
function authJwtSecret(): string {
  if (isProduction) return required('AUTH_JWT_SECRET')
  return process.env.AUTH_JWT_SECRET?.trim() || 'dev-insecure-jwt-secret-change-me'
}
```

Target:

```ts
function authJwtSecret(): string {
  // The known dev secret is acceptable ONLY under the test runner. Every other
  // environment (production, staging, unset NODE_ENV, ...) must supply a real secret,
  // or the process fails fast at startup rather than signing forgeable tokens.
  if (nodeEnv === 'test') {
    return process.env.AUTH_JWT_SECRET?.trim() || 'dev-insecure-jwt-secret-change-me'
  }
  return required('AUTH_JWT_SECRET')
}
```

An operator who still wants the old "just run it locally" ergonomics sets
`NODE_ENV=test` for local dev, or (preferred) exports a throwaway `AUTH_JWT_SECRET`.

## Interface Contract

No HTTP route or DTO changes. The only externally observable change: a non-test process
started without `AUTH_JWT_SECRET` throws the existing `required()` error
(`Missing required environment variable: AUTH_JWT_SECRET`) and does not bind the port.

## Data Model

No tables, indexes, or migrations.

## UI / Platform Impact

Deployment only: every non-test environment (including staging and preview) must define
`AUTH_JWT_SECRET`. Documented in `.env.example` and the auth product doc as a migration
note.

## Observability

The `required()` failure surfaces as a startup exception (fatal). No new logs; the secret
value is never logged (existing pino redaction already covers token fields, and the secret
is not passed to any log line).

## Alternatives Considered

1. Keep `isProduction`-only and rely on deploy discipline — rejected (decision 0023 §Alt 1):
   a single env typo is a full auth bypass.
2. Add an explicit `ALLOW_DEV_JWT_SECRET=1` opt-in for non-test local runs instead of
   piggybacking on `NODE_ENV=test` — heavier surface; deferred unless discovery shows a real
   non-test local-run need.
