# Design — US-028 Close login timing enumeration

## Domain Model

No entity changes. This is a control-flow invariant: "every login attempt costs one password
verify, regardless of whether the account exists."

## Application Flow

Current (`src/application/auth/login.ts:33-40`):

```ts
const [user] = await database.select().from(users).where(eq(users.email, input.email)).limit(1)

if (!user || !user.isActive || !(await verifyPassword(input.password, user.passwordHash))) {
  throw new AppError('INVALID_CREDENTIALS')
}
```

Target:

```ts
// Precomputed once at module load so every request pays the same argon2id cost whether or
// not the account exists — otherwise an unknown email returns fast enough to distinguish
// from a known email with a wrong password (timing enumeration).
const dummyPasswordHash = hashPassword(randomDummySecret())

const [user] = await database.select().from(users).where(eq(users.email, input.email)).limit(1)

const passwordOk = await verifyPassword(input.password, user?.passwordHash ?? (await dummyPasswordHash))

if (!user || !user.isActive || !passwordOk) {
  throw new AppError('INVALID_CREDENTIALS')
}
```

`dummyPasswordHash` is a module-level, lazily-awaited promise (computed once at import time,
not per-request) so the fixed cost is paid once, not re-hashed on every unknown-email attempt.

## Interface Contract

No HTTP route or DTO change. Response body and status are identical for every failure mode
(unknown email, inactive account, wrong password) — only the internal control flow and timing
profile change.

## Data Model

No tables, indexes, or migrations.

## UI / Platform Impact

None.

## Observability

No log changes. `verifyPassword` never throws (returns `false` on mismatch per its existing
contract), so this adds no new error paths.

## Alternatives Considered

1. Random delay/jitter on the fast-fail path — rejected; doesn't reliably defeat timing
   analysis averaged over many requests, and adds latency to a legitimate flow (rate limiting
   already bounds attempt volume, so a deliberate delay buys little).
2. Rely on US-023 rate limiting alone — rejected; bounds attempt *volume* but not a slow,
   low-and-slow enumeration spread over time; the audit flagged this as a distinct, directly
   closeable gap.
