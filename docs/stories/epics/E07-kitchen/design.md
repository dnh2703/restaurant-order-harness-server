# E07 Kitchen — Epic Design

Implements SPEC EPIC 4 (kitchen screen) and SPEC US-9.1 (staff restaurant-wide
realtime stream). Product contract: [`docs/product/kitchen.md`](../../../product/kitchen.md),
[`docs/product/realtime.md`](../../../product/realtime.md).

## Scope & Slicing

| Story | Title | SPEC | Lane |
| --- | --- | --- | --- |
| US-011 | Kitchen queue + status transition | US-4.1, US-4.2 | normal |
| US-012 | Temporary sold-out toggle | US-4.3 | normal |
| US-013 | Staff restaurant-wide SSE stream | US-9.1 | normal |

All kitchen routes are guarded `['KITCHEN', 'ADMIN']`; the staff stream is guarded
`['KITCHEN', 'CASHIER', 'ADMIN']`. **Tenancy comes only from `auth.restaurantId`** (the
verified JWT claim) — never from request body/params — matching the staff-routes pattern
(`src/presentation/http/routes/staff.ts`).

Out of scope for E07 (explicit):

- Item cancellation (`CANCELLED`): transitions are **forward-only**. Cancelling a dish
  belongs to cashier/admin in a later epic.
- Realtime push for the customer **menu**: the customer menu (US-006) is a plain `GET`
  with no SSE consumer, so a sold-out toggle is reflected on the next menu fetch. We do
  **not** add a menu `NOTIFY`/SSE channel (no consumer — YAGNI).
- `order` / `service_request` events on the staff stream: only `order_item` events exist
  in E07. The broker and route stay generic so those event types can be added when
  E08 (cashier) and US-3.4 (call staff / request bill) land.

## US-011 — Queue + Status Transition

### `GET /api/kitchen/queue`

Returns `PENDING` + `COOKING` `order_items` for orders in `auth.restaurantId`, joined to
`orders` → `tables` (table name) and `menu_items`, with each item's chosen options from
`order_item_options`. Sorted by `order_items.created_at` ascending (oldest first), backed
by index `order_items_queue_idx (status, created_at)`.

Card shape per item: `id`, `tableName`, `nameSnapshot`, `quantity`, `note`, `status`,
`createdAt`, `options: [{ optionName, priceDelta }]`.

### `PATCH /api/kitchen/order-items/:id/status`

Body `{ status: 'COOKING' | 'SERVED' }`. Forward-only transition matrix:

| from | allowed to |
| --- | --- |
| PENDING | COOKING |
| COOKING | SERVED |
| SERVED | — (terminal) |

- Illegal transition (backwards, skipping, or from a terminal state) →
  `409 INVALID_TRANSITION` (add code to `error-catalog.ts`).
- Item not found **within `auth.restaurantId`** → `404 NOT_FOUND`. The tenant check is part
  of the same guarded update (filter the `UPDATE ... RETURNING` by a join/subquery on
  `orders.restaurant_id`), so a kitchen token can never advance another restaurant's item.
- The status write fires the existing `order_items_notify` trigger → `NOTIFY realtime`, so
  the customer stream (US-008) and the new staff stream (US-013) both update with **no
  extra publish code** in this use-case.

Concurrency: read-modify-write is collapsed into a single conditional `UPDATE` guarded by
the current status (`WHERE status = <expected-predecessor>`), so two cooks racing the same
item resolve deterministically (one updates, the other gets `0 rows` → `409`).

## US-012 — Temporary Sold-Out

### `PATCH /api/kitchen/menu-items/:id/availability`

Body `{ isAvailable: boolean }`. Sets `menu_items.is_available`. The item must belong to
`auth.restaurantId`, verified via a join `categories.restaurant_id = auth.restaurantId`;
otherwise `404 MENU_ITEM_NOT_FOUND` (reuse the existing code). This is the same flag admin
availability uses (US-6.2); kitchen uses it for short-term stockouts. No realtime emission
(see Out of Scope). The change is observable immediately via the next `GET /api/menu` read,
which already filters/dims on `is_available` (US-006).

## US-013 — Staff Restaurant-Wide SSE Stream

### Migration `drizzle/0002_order_item_notify_restaurant.sql`

Replace `notify_order_item_change()` so the `NOTIFY realtime` payload also carries
`restaurantId`, looked up from `orders.restaurant_id WHERE id = NEW.order_id` (a single PK
lookup per status change). Payload becomes:

```json
{ "type": "order_item", "restaurantId": "...", "orderId": "...",
  "orderItemId": "...", "status": "...", "op": "INSERT|UPDATE" }
```

### Broker (`src/infrastructure/realtime/realtime-broker.ts`)

- Extend `RealtimeEvent` with `restaurantId: string`.
- Add `topicForRestaurant(id) => "restaurant:<id>"`.
- In `publish()`, after parsing, fan the event out to **both** `topicForOrder(orderId)`
  (unchanged — keeps US-008 working) **and** `topicForRestaurant(restaurantId)`. Guard the
  restaurant fan-out behind a present `restaurantId` so a legacy payload (without it) still
  routes to order subscribers.

### `GET /api/stream/restaurant/:id`

Guarded staff SSE (`['KITCHEN','CASHIER','ADMIN']`). Subscribes to
`topicForRestaurant(auth.restaurantId)`. The `:id` path param **must equal**
`auth.restaurantId`, else `403 FORBIDDEN` — a staff token cannot watch another tenant's
stream. Keep-alive ticks + `finally`-unsubscribe mirror the customer stream (`stream.ts`).
Emits `event: order_item.updated` with `{ orderItemId, orderId, status, tableName? }`.

> FE note (out of BE scope): browser `EventSource` cannot send an `Authorization` header,
> so the staff FE will use a fetch-based SSE client / polyfill to carry the Bearer token.
> The BE contract stays Bearer-guarded, consistent with all other staff routes.

## Files

| Path | Change |
| --- | --- |
| `drizzle/0002_order_item_notify_restaurant.sql` | new — enrich trigger payload |
| `src/infrastructure/realtime/realtime-broker.ts` | add `restaurantId`, restaurant topic + fan-out |
| `src/application/kitchen/get-queue.ts` | new — queue query (tenant-scoped) |
| `src/application/kitchen/advance-item-status.ts` | new — transition matrix + conditional update |
| `src/application/kitchen/set-item-availability.ts` | new — sold-out toggle (tenant-scoped) |
| `src/presentation/http/routes/kitchen.ts` | new — three guarded routes |
| `src/presentation/http/routes/stream.ts` | add staff `/stream/restaurant/:id` route |
| `src/shared/errors/error-catalog.ts` | add `INVALID_TRANSITION` (409) |
| `src/presentation/http/app.ts` | mount kitchen routes |

## Validation Shape (per story)

| Layer | Proof |
| --- | --- |
| Unit | transition matrix (allowed/illegal); queue sort/filter shape; broker fan-out to both topics; payload parse incl. `restaurantId` |
| Integration | status PATCH persists + emits NOTIFY to a subscribed test client; sold-out toggle hides item from `GET /api/menu`; staff stream receives event on status change; tenant isolation (cross-restaurant item → 404, cross-restaurant stream → 403) |
| E2E | item submitted → appears in queue → cook advances PENDING→COOKING→SERVED → customer stream + staff stream both reflect SERVED |
| Platform | staff SSE survives Neon scale-to-zero; broker reconnect still routes to both topics |

## Harness Delta

Completes the kitchen side of the `PENDING → COOKING → SERVED` lifecycle and lands the
staff restaurant-wide stream foundation (US-9.1) on the US-008 broker, ready for E08
(cashier) to add `order` / `service_request` events.
