# 0022 Remove SSE — realtime becomes polling-only

Date: 2026-07-04

## Status

Accepted (supersedes the realtime portion of decision 0008)

## Context

Decision 0008 chose SSE for order-item status, backed by a `RealtimeBroker` that holds a
single permanent Postgres `LISTEN` connection on `DATABASE_URL_UNPOOLED` (PgBouncer
transaction pooling cannot hold a `LISTEN`). US-008 shipped the customer stream and US-013
the staff stream.

In operation this costs more than it returns for a single-restaurant / few-branch workload:

- The permanent `LISTEN` connection keeps Neon compute alive 24/7 — it never scales to
  zero, even overnight when the restaurant is closed.
- Two delivery paths must be maintained for one feature: SSE plus the polling fallback the
  FE already needs, because mobile QR clients, backgrounded tabs, and idle proxies routinely
  drop SSE.
- Broker reconnect/backoff, keep-alive, and the backpressure iterator are moving parts with
  no equivalent on the polling side.

"Is my dish ready?" tolerates a 2–3s poll, and the polling endpoints already exist and were
already the documented SSE fallback.

## Decision

Remove SSE entirely; order-item status is delivered by polling existing endpoints:

- Customer: `GET /api/qr/:qrToken/order`.
- Staff: `GET /api/kitchen/queue` and `GET /api/kitchen/served-recent`.

Concretely: delete the `RealtimeBroker`, the SSE routes (`/api/qr/:qrToken/stream`,
`/api/stream/restaurant/:id`), `createListenerClient`, and the `DATABASE_URL_UNPOOLED`
env var (the broker was its only consumer). Drop the `order_items_notify` trigger and
`notify_order_item_change()` function (migration `0004`) so no `pg_notify` fires into the
void on every write.

## Alternatives Considered

1. Keep SSE but make the broker lazy-start (open the `LISTEN` only while a subscriber is
   connected) so Neon can still scale to zero — rejected: still maintains two delivery paths
   and all the broker machinery for latency this product does not need.
2. Keep the DB trigger for a possible future re-enable — rejected: a trigger firing into no
   listener is pure waste; re-adding it later is one small migration.

## Consequences

Positive:

- Neon compute can scale to zero again; no permanently-held connection.
- One delivery path (polling) instead of two; less code and fewer moving parts.
- No infrastructure dependency on long-lived connections / proxy tuning.

Tradeoffs:

- Status updates land on a 2–3s poll cadence instead of sub-second push.
- Breaking change for the FE: the two `/stream` endpoints now 404; the FE must poll (its
  documented fallback). Tracked as a follow-up FE task.

## Follow-Up

- FE task: remove `EventSource` usage and poll `GET /api/qr/:qrToken/order` (customer) and
  `GET /api/kitchen/queue` (staff) every 2–3s.
- Stories US-008 and US-013 move to `retired`; `docs/product/realtime.md` rewritten to
  polling-only.
