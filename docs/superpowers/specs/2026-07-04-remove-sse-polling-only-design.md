# Remove SSE — realtime becomes polling-only

**Date:** 2026-07-04
**Status:** Approved
**Branch:** `refactor/remove-sse-polling-only`

## Problem

Order-item status is delivered to customers (US-008 / SPEC US-9.2) and staff
(US-013 / SPEC US-9.1) over Server-Sent Events, backed by a `RealtimeBroker` that
holds a permanent Postgres `LISTEN` connection (decision 0008). The broker uses
`DATABASE_URL_UNPOOLED` because PgBouncer transaction pooling does not support
`LISTEN/NOTIFY`.

For a single-restaurant / few-branch workload this costs more than it returns:

- The permanent `LISTEN` connection keeps Neon compute alive 24/7 — it never
  scales to zero, even overnight.
- Two delivery paths must be maintained for one feature: SSE plus the polling
  fallback the FE already needs (mobile QR clients, background tabs, idle proxies
  routinely drop SSE).
- Broker reconnect/backoff, keep-alive, and the backpressure iterator are moving
  parts with no equivalent on the polling side.

Latency of "is my dish ready" tolerates a 2–3s poll, and the polling endpoints
already exist and are already the documented fallback.

## Decision

Remove SSE entirely; realtime status becomes polling-only against existing
endpoints. Selected options (both recommended):

1. **Full removal including the DB trigger** — also drop the `pg_notify` trigger
   so it stops firing into the void on every `order_items` write.
2. **Full Harness docs update** — a new decision record supersedes the realtime
   portion of 0008; stories US-008/US-013 move to retired/polling-only.

## Existing polling endpoints (unchanged, no FE-facing additions)

- `GET /api/qr/:qrToken/order` — customer order with items + statuses (US-007).
- `GET /api/kitchen/queue` — PENDING+COOKING make-queue.
- `GET /api/kitchen/served-recent` — recently served items.

## Changes

### Application code (delete)

| File | Action |
|---|---|
| `src/presentation/http/routes/stream.ts` | Delete file |
| `src/presentation/http/app.ts` | Remove `import` + `.use(streamRoutes)` |
| `src/infrastructure/realtime/realtime-broker.ts` | Delete file (incl. `broker` singleton) |
| `src/index.ts` | Remove `broker` import, `broker.start()`, `broker.stop()` |
| `src/infrastructure/database/client.ts` | Remove `createListenerClient` + LISTEN/NOTIFY comment |
| `src/infrastructure/config/env.ts` | Remove `databaseUrlUnpooled` / `DATABASE_URL_UNPOOLED` (broker was the only consumer) |

Verify `src/infrastructure/realtime/` is empty after deletion and remove the dir.

### Database migration

New migration `drizzle/0004_drop_order_item_notify.sql`:

```sql
DROP TRIGGER IF EXISTS order_items_notify ON order_items;
--> statement-breakpoint
DROP FUNCTION IF EXISTS notify_order_item_change();
```

Append the matching entry (idx 4) to `drizzle/meta/_journal.json`. Generate via
the project's drizzle-kit flow if available so the meta snapshot stays consistent;
otherwise hand-write the journal entry to match the existing format.

### Tests

Delete SSE-specific tests:

- `test/realtime-broker.test.ts`
- `test/realtime-integration.test.ts`
- `test/stream.test.ts`
- `test/kitchen/staff-stream.integration.test.ts`

**Keep** `test/logging/request-logger-streaming.test.ts` — it builds a
self-contained `sse()` generator to exercise the request logger's `mapResponse`
hook against a streaming response; it does not import the broker or the stream
route, and streaming responses remain a valid code path.

### Comment cleanup

Update comments that describe NOTIFY/stream delivery to match polling reality:

- `src/application/kitchen/advance-item-status.ts`
- `src/application/kitchen/set-item-availability.ts`
- `src/presentation/http/routes/kitchen.ts`

### Harness docs

- Add decision `docs/decisions/0022-*.md` superseding the realtime-broker portion
  of 0008; rationale = operational cost + Neon scale-to-zero + polling is
  sufficient at this scale.
- Annotate `docs/decisions/0008-restaurant-qr-architecture.md` as superseded for
  the realtime section.
- Update stories `US-008` and `US-013` to retired / polling-only.

## Breaking change (FE)

`GET /api/qr/:qrToken/stream` and `GET /api/stream/restaurant/:id` will return
404 after this change. The FE must poll the endpoints above (their documented
fallback). A follow-up FE task will track the switch away from `EventSource`.

## Verification

- `bun test` — full suite green after deletions.
- Typecheck.
- App boots without `DATABASE_URL_UNPOOLED` set.
- No remaining references to `broker`, `RealtimeBroker`, `streamRoutes`,
  `createListenerClient`, or `databaseUrlUnpooled` in `src/`.
