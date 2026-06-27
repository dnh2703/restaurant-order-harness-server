# US-008 Realtime Customer Order Stream

## Status

planned

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

Add after implementation.
