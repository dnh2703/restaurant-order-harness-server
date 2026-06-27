# Realtime

Covers EPIC 9. Kitchen, cashier, and customer see updates immediately with no reload.

## Mechanism

```text
use-case writes to DB
  -> Postgres NOTIFY <channel>, <payload>
  -> single Elysia LISTEN connection (RealtimeBroker)
  -> broadcast SSE to subscribed clients of the correct restaurant / order
```

- The backend holds the `LISTEN` connection. **Clients never `LISTEN` directly** —
  important under Neon scale-to-zero (one server-held listener keeps compute warm /
  predictable instead of many idle client connections).
- Payloads are small (ids + change type); clients refetch or patch local state.

## Channels & Events

| Channel | Emitted when | Consumers |
| --- | --- | --- |
| `restaurant:<id>` | order_item / order / service_request changes | kitchen, cashier |
| `order:<orderId>` | an item changes PENDING→COOKING→SERVED | that table's customer |
| `menu:<restaurantId>` | menu_item availability toggles | customers viewing menu |

## Endpoints

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| GET | `/stream/restaurant/:id` | staff (access token) | SSE of restaurant-wide changes (US-9.1) |
| GET | `/stream/order/:orderId` | none, scoped by QR session | SSE of one order's item statuses (US-9.2) |

- SSE messages use named events (`event: order_item.updated`) and a JSON `data` line.
- Send periodic keep-alive comments to hold the connection open.

## Fallback (US-9.3)

- If SSE fails or is unsupported, the FE polls the equivalent GET endpoint every
  2–3 seconds. MVP may ship with polling first and add SSE second.

## Rules

- A customer SSE stream only exposes their own order; authorize by the order's QR
  session, never by guessing `orderId`.
- Staff SSE is filtered to the token's `restaurantId`.

## Validation Shape

| Layer | Proof |
| --- | --- |
| Unit | broker fan-out routing (event → correct subscribers); payload shape |
| Integration | DB write triggers NOTIFY → broker emits to subscribed test client |
| E2E | kitchen advances item → customer stream receives update without reload |
