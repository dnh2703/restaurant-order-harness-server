# Overview — US-013 Staff Restaurant-Wide SSE Stream

## Current Behavior

US-008 established the `RealtimeBroker`: a single backend `LISTEN` connection fanning `NOTIFY`
payloads to per-order subscribers (`order:<id>`) for the customer stream. Staff screens (kitchen,
cashier) have no realtime feed — they would have to poll.

## Target Behavior

Authenticated staff (`KITCHEN`, `CASHIER`, `ADMIN`) open one SSE stream for their whole
restaurant and receive every `order_item` status change live:

- `GET /api/stream/restaurant/:id` — guarded; the path `:id` must equal the token's
  `restaurantId`, else `403 FORBIDDEN`. Missing/invalid token → `401`.
- The `order_items` NOTIFY trigger is enriched (migration `0002`) to carry `restaurantId`, so the
  broker fans each notification to BOTH `order:<id>` (customer, unchanged) and `restaurant:<id>`
  (staff). One backend listener; clients never `LISTEN` directly (matters under Neon
  scale-to-zero).
- Implements SPEC US-9.1 and reuses the keep-alive SSE loop from US-008 (FE falls back to polling
  the kitchen queue on SSE failure).

## Affected Users

- `KITCHEN` / `CASHIER` / `ADMIN` — gain a live restaurant-wide order feed.
- `Customer` — unaffected; the existing `order:<id>` routing is preserved (legacy payloads
  without `restaurantId` still route to order subscribers).

## Affected Product Docs

- `docs/product/realtime.md` (US-9.1)
- `docs/product/kitchen.md`
- `docs/decisions/0008-restaurant-qr-architecture.md` (broker)

## Non-Goals

- `order` / `service_request` events on the stream — only `order_item` events exist in E07; those
  arrive with E08 (cashier) and US-3.4 (call staff / request bill).
- A per-event DB lookup to enrich the SSE payload — the FE refetches the queue for card detail.
