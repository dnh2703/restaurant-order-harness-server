# Design — US-008 Realtime Customer Order Stream

Date: 2026-06-28
Branch: `feat/us-008-customer-order-stream` (from `main`, after US-007 merged)
Story: `docs/stories/epics/E05-realtime/US-008-customer-order-stream.md`
Product docs: `docs/product/realtime.md`, `docs/product/ordering.md`

## Goal

Push live `order_item` status updates (`PENDING → COOKING → SERVED`) to a customer
over Server-Sent Events (SSE) so their screen updates without a reload. The backend
holds a single Postgres `LISTEN` connection (the `RealtimeBroker`) and fans out
`NOTIFY` payloads to subscribed SSE clients. This implements SPEC US-9.2 (customer
side of US-3.3) and establishes the broker foundation that US-9.1 (staff stream,
sliced with E07) will build on.

## Non-Goals (deferred)

- Staff restaurant-wide stream `/stream/restaurant/:id` (US-9.1, with E07).
- `restaurant:<id>` and `menu:<id>` logical channels — broker stays generic enough
  to add them later, but only `order:<orderId>` is wired now.
- Application-level `pg_notify` from kitchen use-cases — those use-cases (E07) do
  not exist yet; the DB trigger covers emission for now.
- Initial snapshot on stream open (see Decision D4).
- Frontend implementation (this is a backend server; FE polling fallback is only
  documented, not built here).

## Decisions (approved during brainstorming)

- **D1 — Endpoint & auth:** `GET /api/qr/:qrToken/stream`. Reuses the existing
  qrToken-based authorization of the other customer routes; the backend resolves
  `orderId` from the token server-side. Never exposes another order by guessing an id.
  (Chosen over the spec's literal `/stream/order/:orderId`, which would rely on UUID
  obscurity and split from the established `/api/qr/...` pattern.)
- **D2 — NOTIFY source:** a Postgres trigger on `order_items` (`AFTER INSERT OR
  UPDATE OF status`) calls `pg_notify`. Auto-emits the moment any code changes a row,
  so US-008 is testable now without the (not-yet-built) E07 kitchen use-cases.
- **D3 — Unpooled connection:** a new required env var `DATABASE_URL_UNPOOLED`
  (Neon direct host) backs the broker's `LISTEN` connection. PgBouncer transaction
  pooling (the `-pooler` host used by `DATABASE_URL`) does not support `LISTEN/NOTIFY`,
  so the broker needs a direct connection. App traffic keeps using the pooled host.
- **D4 — No initial snapshot:** the stream only pushes changes from open-time onward.
  The FE calls `GET /api/qr/:qrToken/order` immediately before opening the stream, so
  the gap is tiny and the 2–3s polling fallback covers any missed event. (YAGNI.)
- **D5 — Route file:** a dedicated `routes/stream.ts`, separate from the CRUD-only
  `routes/qr.ts`, because the SSE handler is stateful (depends on the broker singleton,
  uses an async generator + keep-alive + disconnect cleanup).

## 1. Channel & payload model

Postgres cannot `LISTEN` to a wildcard or dynamically-named channel, so the system
uses **one physical Postgres channel** named `realtime`. The orderId lives in the
JSON payload; the broker routes in-memory to logical topics keyed `order:<orderId>`.
This matches the product doc's conceptual `order:<orderId>` channel while staying
technically sound.

NOTIFY payload (small — ids + change type, per `realtime.md`):

```json
{ "type": "order_item", "orderId": "<uuid>", "orderItemId": "<uuid>", "status": "COOKING", "op": "UPDATE" }
```

SSE event delivered to the client:

```
event: order_item.updated
data: {"orderItemId":"<uuid>","orderId":"<uuid>","status":"COOKING"}
```

The FE patches local state or refetches `GET /api/qr/:qrToken/order`.

## 2. Postgres trigger (migration)

A new **custom** drizzle migration (`drizzle/0001_*.sql`, plus its journal entry) adds:

```sql
CREATE OR REPLACE FUNCTION notify_order_item_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'realtime',
    json_build_object(
      'type', 'order_item',
      'orderId', NEW.order_id,
      'orderItemId', NEW.id,
      'status', NEW.status,
      'op', TG_OP
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER order_items_notify
  AFTER INSERT OR UPDATE OF status ON order_items
  FOR EACH ROW EXECUTE FUNCTION notify_order_item_change();
```

- Fires on INSERT (customer adds items via US-007 — lets multiple devices on the same
  table sync) and on any `status` UPDATE (future kitchen transitions).
- DDL runs fine over the pooled connection; `db:migrate` is unchanged.
- `pg_notify` payload limit is 8000 bytes — our payload is well under it.

## 3. RealtimeBroker — `src/infrastructure/realtime/realtime-broker.ts`

A small, framework-agnostic class plus an exported singleton.

**Responsibilities**

- Hold a single `pg.Client` built from `DATABASE_URL_UNPOOLED` (direct host) and run
  `LISTEN realtime`. Not the shared `pg.Pool` (which is pooled and can't LISTEN).
- On `notification`: parse the JSON payload, compute `topic = order:<orderId>`, and
  fan out to that topic's subscribers. Malformed payloads are ignored (logged once).
- `subscribe(topic): Subscription` — registers a listener and returns an object with
  an async iterator (or event emitter) of events plus an `unsubscribe()`.
- `unsubscribe` — removes the listener; drops empty topic sets.
- `start()` / `stop()` — connect/LISTEN and disconnect; idempotent.
- **Reconnect:** on connection `error`/`end`, reconnect with exponential backoff
  (capped) and re-issue `LISTEN`. Subscribers stay registered across reconnects; events
  emitted during downtime are missed (polling fallback compensates).

**Internal shape**

- `Map<string, Set<Subscriber>>` keyed by topic.
- A `Subscriber` is a push function / queue feeding the SSE generator.

The single server-held listener (rather than many client LISTENs) is what keeps the
Neon compute predictably warm under scale-to-zero — the explicit rationale in
`realtime.md`.

## 4. Connection helper — `src/infrastructure/database/client.ts`

Add a factory that creates a **direct** `pg.Client` from `env.databaseUrlUnpooled`
(with the same `connectionTimeoutMillis` / `keepAlive` tuning rationale). The broker
owns its lifecycle; this is not added to the shared pool. The existing `pool`/`db`
exports are unchanged.

## 5. Env — `src/infrastructure/config/env.ts`

Add `databaseUrlUnpooled: required('DATABASE_URL_UNPOOLED')`. Update `.env.example`
(and local `.env`) with the Neon direct host. CI sets a dummy value alongside the
existing dummy `DATABASE_URL` (broker-dependent tests self-skip when the DB is
unreachable, per the existing Neon test convention).

## 6. orderId lookup — `src/application/orders/resolve-order-id.ts`

A read-only query: given a `qrToken`, return the `orderId` of the table's OPEN order.

- Unknown/regenerated token → 404 `INVALID_TABLE` (via the global error handler,
  consistent with the other QR routes).
- No OPEN order for the table → 404 `INVALID_TABLE` (in practice US-005 opens one on
  scan, so by stream-open time an order exists).
- Must NOT have side effects (unlike `resolveTableSession`, which opens/reuses an
  order). Streaming must never create an order.

## 7. SSE endpoint — `src/presentation/http/routes/stream.ts`

`GET /api/qr/:qrToken/stream`

1. `resolveOrderId(db, qrToken)` → 404 before any streaming begins.
2. `broker.subscribe('order:' + orderId)`.
3. Return an async generator that:
   - `yield sse({ event: 'order_item.updated', data })` for each received event
     (using Elysia 1.4's `sse` helper / async-generator streaming).
   - emits a keep-alive comment (`: keep-alive`) roughly every 20s to hold the
     connection open through proxies.
   - on client disconnect (request abort signal / generator return) calls
     `subscription.unsubscribe()` to avoid leaks.
4. Mounted in `app.ts` via `.use(streamRoutes)`.

The handler documents (comment + OpenAPI `detail`) that clients falling back from SSE
should poll `GET /api/qr/:qrToken/order` every 2–3s (US-9.3).

## 8. Lifecycle wiring — `src/index.ts`

- `await broker.start()` on boot (after env validates, before/around `app.listen`).
- `broker.stop()` on `SIGINT`/`SIGTERM` for clean shutdown.
- Tests drive `app.handle(...)` and start/stop the broker explicitly; the route imports
  the broker singleton.

## 9. Error handling summary

| Situation | Behavior |
| --- | --- |
| Invalid/unknown qrToken | 404 `INVALID_TABLE` before stream upgrade |
| No OPEN order for table | 404 `INVALID_TABLE` |
| Broker LISTEN connection drops (Neon idle) | reconnect w/ backoff + re-LISTEN; subscribers retained; gap covered by polling |
| Malformed NOTIFY payload | ignored, logged once; does not crash broker |
| Client disconnects | `unsubscribe`, generator returns, no leak |

## 10. Testing

Validation matrix (`story update --id US-008 --unit 1 --integration 1 --e2e 0 --platform 1`):

| Layer | Proof |
| --- | --- |
| Unit | broker fan-out routing (sub `order:A`; publish A → received, publish B → not); subscriber add/remove; payload parse + malformed-ignore — no DB |
| Unit (platform) | reconnect logic: simulated connection drop → broker reconnects and re-LISTENs; subscribers preserved |
| Integration | start broker on test DB → `UPDATE order_items SET status` → assert subscribed test listener receives the event (exercises trigger + LISTEN end-to-end). Self-skips when DB unreachable. |
| Route | `GET /api/qr/:qrToken/stream` returns `text/event-stream`; bad token → 404; (broker manually publishes an event → handler yields it) |
| Platform | polling fallback documented; `GET /order` route already tested under US-007 |

CI runs unit + route tests with dummy env; integration test self-skips without a live DB
(existing Neon test convention).

## 11. File summary

| File | Change |
| --- | --- |
| `drizzle/0001_*.sql` + `drizzle/meta/*` | new: notify function + trigger |
| `src/infrastructure/realtime/realtime-broker.ts` | new: broker + singleton |
| `src/infrastructure/database/client.ts` | add direct-client factory |
| `src/infrastructure/config/env.ts` | add `databaseUrlUnpooled` |
| `.env.example` (+ local `.env`) | add `DATABASE_URL_UNPOOLED` |
| `src/application/orders/resolve-order-id.ts` | new: read-only orderId lookup |
| `src/presentation/http/routes/stream.ts` | new: SSE endpoint |
| `src/presentation/http/app.ts` | mount `streamRoutes` |
| `src/index.ts` | broker start/stop lifecycle |
| `test/realtime-broker.test.ts` | new: unit + reconnect |
| `test/stream.test.ts` | new: route test |
| `test/realtime-integration.test.ts` | new: DB→NOTIFY→broker (self-skips) |
| `.github/workflows/ci.yml` | add dummy `DATABASE_URL_UNPOOLED` |
