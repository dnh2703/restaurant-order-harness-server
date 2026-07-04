# Design — US-023 Rate limiting for authentication and expensive endpoints

## Domain Model

No domain entities. Introduces a transient concept: a **rate-limit counter** keyed by
(bucket, key) with a rolling or fixed window, held outside the domain layer
(infrastructure/presentation).

## Application Flow

Rate limiting is a presentation-layer concern (an Elysia plugin/guard), applied before the
route handler runs. It does not enter the application use-cases. Login stays otherwise
unchanged; on limit breach the request is rejected with `429` before `loginUseCase` runs.

Key strategy for login:

- Per-IP counter: caps volume from one source.
- Per-account (normalized email) counter: caps guessing against one victim across IPs.
- Breach on **either** → `429`. The account counter must not reveal existence: apply it to
  the submitted email regardless of whether the account exists (constant behavior).

Global limiter: per-IP counter over QR read/scan and `POST /api/menu-items/image`.

## Interface Contract

- New error code `TOO_MANY_REQUESTS` → HTTP `429`, returned in the standard error envelope
  (`docs/product/api-conventions.md`). Include a `Retry-After` header (seconds).
- Login response set becomes `{200, 401, 422, 429}`.
- Error body must be identical for existing vs unknown account when rate-limited (no
  enumeration).

## Data Model

No Postgres tables. Baseline store is **in-memory** (per process): a `Map` of key → window
state with lazy eviction. Documented limitation: counters are per-instance and reset on
restart; a shared store (e.g. Redis) is the future upgrade for multi-instance deploys.

## UI / Platform Impact

- Client (FE) must handle `429` on login (show "too many attempts, try again in N s") and
  respect `Retry-After`. Tracked for FE as a follow-up once implemented.
- Deployment: the app must see the real client IP. Behind a proxy/CDN, derive it from the
  trusted forwarded header; document which header the target deploy sets to avoid a single
  shared bucket or a spoofable key.

## Observability

- Log a throttling event at `warn` (key bucket, not the raw secret/password) when a request
  is rejected, for abuse visibility. Never log the attempted password.
- Optional counter/metric of 429s per bucket for tuning.

## Alternatives Considered

1. Reverse-proxy / edge rate limiting only — complementary but leaves local/single-container
   deploys unprotected (decision 0023 §Alt 2). In-app baseline chosen.
2. Account lockout (disable after N failures) instead of throttling — rejected: enables a
   denial-of-service against known staff emails; sliding throttle is safer.
3. Redis-backed shared store from day one — deferred: adds an external dependency the
   current single-instance topology does not need; noted as the scale-out path.
