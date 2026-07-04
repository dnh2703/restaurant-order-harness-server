# Realtime

Covers EPIC 9. Kitchen, cashier, and customer stay current with order-item status.

> **Polling-only (decision 0022, 2026-07-04).** SSE and the `RealtimeBroker` were removed.
> Clients poll existing GET endpoints on a short interval; there is no server push, no
> Postgres `LISTEN/NOTIFY`, and no long-lived connection. This lets Neon compute scale to
> zero and removes the second (SSE) delivery path.

## Mechanism

```text
use-case writes status to DB
  -> client re-reads the relevant GET endpoint every 2–3s
  -> UI reflects the new status on the next poll
```

- No backend `LISTEN` connection and no `pg_notify` trigger — both were removed.
- Payloads already carry item statuses, so the client patches local state from each read.

## Endpoints (polled)

| Method | Path | Auth | Consumers |
| --- | --- | --- | --- |
| GET | `/api/qr/:qrToken/order` | none, scoped by QR session | that table's customer |
| GET | `/api/kitchen/queue` | staff (access token) | kitchen (PENDING+COOKING make-queue) |
| GET | `/api/kitchen/served-recent` | staff (access token) | kitchen (recently served) |

- Poll cadence: every 2–3 seconds while the screen is open.

## Rules

- A customer only reads their own order, authorized by the QR session's `qrToken` (the
  `orderId` is resolved server-side, never guessed).
- Staff reads are filtered to the token's `restaurantId`.

## Validation Shape

| Layer | Proof |
| --- | --- |
| Unit | endpoint returns correct item statuses for the scoped order / restaurant |
| Integration | kitchen advances an item → next GET reflects the new status |
| E2E | customer/staff screen shows the updated status on its next poll |
