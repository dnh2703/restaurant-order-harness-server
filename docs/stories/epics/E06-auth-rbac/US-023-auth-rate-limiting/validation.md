# Validation — US-023 Rate limiting for authentication and expensive endpoints

## Proof Strategy

Prove that requests under the limit pass unchanged, requests over the limit get `429` with
`Retry-After`, the window resets, per-IP and per-account buckets are independent, and the
rate-limited response does not leak account existence.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Counter/window logic: N allowed then next → blocked; window expiry re-allows; per-key isolation; eviction of stale keys. |
| Integration | `POST /api/auth/login`: burst past the IP limit → `429` + `Retry-After`; burst past the per-account limit from varied IPs → `429`; identical 429 body for known vs unknown email; a legitimate single failed login is not throttled. Global limiter: burst on a QR read / upload → `429`. |
| E2E | Normal login → 200 still works; after breach, wait past the window → login succeeds again. |
| Platform | Client-IP derivation behind the deploy proxy yields distinct buckets per client (not one shared bucket); documented header respected. |
| Performance | Limiter adds negligible per-request overhead; memory bounded under sustained distinct keys (eviction works). |
| Logs/Audit | Throttling events logged at `warn` with the bucket key; the attempted password never appears in logs. |

## Fixtures

- Deterministic staff account (existing seed) as the per-account target.
- A known-absent email to prove non-enumeration under throttling.
- Test config with small window/limit values so bursts are cheap to drive.

## Commands

```text
bun test test/auth            # login throttle cases
bun test                      # full suite green
bun run typecheck && bun run lint
```

## Acceptance Evidence

Add results after verification.
