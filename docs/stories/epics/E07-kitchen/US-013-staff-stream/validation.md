# Validation — US-013 Staff Restaurant-Wide SSE Stream

## Proof Strategy

A real status change propagates end-to-end to the restaurant topic carrying `restaurantId`; the
route is authenticated and tenant-scoped; the customer (`order:<id>`) routing from US-008 is not
regressed.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | broker fans one NOTIFY to both order + restaurant subscribers; legacy payload without restaurantId still routes to the order subscriber |
| Integration | DB status change → trigger NOTIFY (with restaurantId) → broker emits to a restaurant subscriber; route `:id` ≠ token restaurant → 403; no token → 401 |
| E2E | cook advances an item → the restaurant stream receives `order_item.updated` COOKING |
| Platform | broker holds the LISTEN on a Neon test branch (DATABASE_URL_UNPOOLED); survives scale-to-zero via reconnect/backoff |

## Fixtures

Per-suite restaurant → category → menu item → table → OPEN order. Broker started in `beforeAll`
with a `waitForBrokerConnected` round-trip probe (synthetic `pg_notify` echoed back) before timed
tests. KITCHEN token via `signAccessToken`.

## Commands

```text
bun test test/kitchen/staff-stream.integration.test.ts
bun test test/realtime-broker.test.ts
bun test                  # full suite (regression)
bun run typecheck && bun run lint && bun run format:check
```

Registered:
`scripts/bin/harness-cli story update --id US-013 --verify "bun test test/kitchen/staff-stream.integration.test.ts"`
and `--unit 1 --integration 1 --e2e 1 --platform 1`.

## Acceptance Evidence

Verified against the Neon test branch 2026-06-28.

- `test/realtime-broker.test.ts` — 13 pass, including the two new fan-out cases (both topics; legacy
  payload still routed).
- `test/kitchen/staff-stream.integration.test.ts` — 3 pass: 403 on mismatched `:id`, 401 without a
  token, and the end-to-end status change delivering `COOKING` with `restaurantId` on the
  restaurant topic (proves migration `0002` payload + broker fan-out + LISTEN round-trip).
- Migration `drizzle/0002_order_item_notify_restaurant.sql` applied via `drizzle-kit migrate`.
- Full suite `bun test` → **125 pass / 0 fail** across 29 files. `typecheck`, `lint`,
  `format:check` clean.
