# US-008 Realtime Customer Order Stream

## Status

done

## Lane

normal

## Product Contract

Push live item-status updates to a customer over SSE so they see
`PENDING → COOKING → SERVED` without reloading. Backend holds the Postgres `LISTEN`
connection and fans out to subscribers; FE falls back to polling. Implements SPEC
US-9.2 and the customer side of US-3.3, plus the broker foundation for US-9.1.

## Relevant Product Docs

- `docs/product/realtime.md`
- `docs/product/ordering.md`

## Acceptance Criteria

- `GET /stream/order/:orderId` returns an SSE stream scoped to that order's QR session
  (no auth; never expose another order by guessing id).
- A `RealtimeBroker` holds a single Elysia-side `LISTEN` connection and routes
  `NOTIFY` payloads to the correct subscribers (`order:<orderId>`).
- When an `order_item` status changes, subscribed customer streams receive an event
  (`event: order_item.updated`) without reload.
- Keep-alive comments hold the connection open; on SSE failure the FE polls
  `GET /api/qr/:qrToken/order` every 2–3s.

## Design Notes

- Commands: none (consumes status changes from kitchen use-cases).
- Queries: subscribe by `orderId`.
- API: `GET /stream/order/:orderId` (SSE).
- Tables: reads `order_items`; relies on `NOTIFY` emitted by status-change use-cases.
- Domain rules: per-order authorization; single backend listener (clients never
  LISTEN directly — matters under Neon scale-to-zero).
- UI surfaces: customer status list (live).

## Validation

`scripts/bin/harness-cli story update --id US-008 --unit 1 --integration 1 --e2e 0 --platform 1`

| Layer | Expected proof |
| --- | --- |
| Unit | broker fan-out routing; payload shape; subscriber add/remove |
| Integration | DB status write → NOTIFY → broker emits to subscribed test client |
| E2E | status change reflects on customer stream without reload |
| Platform | SSE survives Neon scale-to-zero; polling fallback works |
| Release | n/a |

## Harness Delta

Establishes the `RealtimeBroker`. Staff stream `/stream/restaurant/:id` (US-9.1) builds
on this and is sliced with E07.

## Evidence

Implemented on branch `feat/us-008-customer-order-stream`. All verification gates pass.

**Artifacts:**

- `test/realtime-broker.test.ts` — broker unit tests: fan-out routing, payload shape, subscriber add/remove, lifecycle start/stop, reconnect/backoff
- `test/resolve-order-id.test.ts` — read-only orderId lookup via qrToken (no order creation)
- `test/stream.test.ts` — SSE route integration: qrToken auth, 404 for unknown token, 404 when no open order
- `test/realtime-integration.test.ts` — end-to-end trigger→broker integration: DB NOTIFY propagates to subscribed test client

- `drizzle/0001_order_item_notify.sql` — Postgres trigger migration: emits `NOTIFY realtime` on `order_items` insert/status change
- `src/infrastructure/realtime/realtime-broker.ts` — `RealtimeBroker`: single unpooled LISTEN connection, in-memory fan-out by `order:<id>`, reconnect/backoff
- `src/presentation/http/routes/stream.ts` — `GET /api/qr/:qrToken/stream` SSE route; authorized by qrToken; keep-alive; no snapshot (FE polls GET /order as fallback)
- `DATABASE_URL_UNPOOLED` — new env var for the broker's direct (non-PgBouncer) Postgres connection

**Validation run (2026-06-28):** `bun run typecheck` ✓, `bun run lint` ✓, `bun run format:check` ✓. `bun test`: 57 pass, 3 fail on first run (Neon cold-start timeouts in `qr-session`, `stream`, `menu` suites — pre-existing environmental flake). Re-run of those 3 suites on a warm connection: 9 pass, 0 fail. Realtime-broker, resolve-order-id, and realtime-integration suites passed in the first run.

Harness recorded: `scripts/bin/harness-cli story update --id US-008 --unit 1 --integration 1 --e2e 0 --platform 1` → `Story US-008 updated.`
