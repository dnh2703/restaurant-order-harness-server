# Kitchen

Covers EPIC 4 (kitchen screen). Staff role `KITCHEN` (or `ADMIN`).

## Queue (US-4.1)

- Show `PENDING` and `COOKING` `order_items` across all open tables, in realtime.
- Each card shows: table name, dish `name_snapshot`, `quantity`, `note`, and chosen
  options.
- Sorted by `created_at` ascending (oldest first) — backed by index
  `order_items(status, created_at)`.

## Update Status (US-4.2)

- Transition an item `PENDING → COOKING → SERVED`.
- Illegal transitions (e.g. `SERVED → PENDING`) are rejected `409 INVALID_TRANSITION`.
- Each transition writes to DB → `NOTIFY` → realtime push to the customer (their
  status view) and the cashier (table totals). See [`realtime.md`](realtime.md).

## Temporary Sold-Out (US-4.3)

- Kitchen can mark a `menu_item` `is_available = false` to hide/dim it on the customer
  menu immediately (realtime menu update).
- This is the same flag as admin availability (see [`menu.md`](menu.md)); kitchen uses
  it for short-term stockouts.

## Endpoints

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| GET | `/api/kitchen/queue` | KITCHEN | PENDING+COOKING items, sorted by created_at |
| PATCH | `/api/kitchen/order-items/:id/status` | KITCHEN | advance item status |
| PATCH | `/api/kitchen/menu-items/:id/availability` | KITCHEN | toggle sold-out |

## Validation Shape

| Layer | Proof |
| --- | --- |
| Unit | allowed status-transition matrix; queue sort/filter |
| Integration | status PATCH persists + emits NOTIFY; sold-out toggle hides item from customer menu read |
| E2E | item submitted → appears in queue → cook advances → customer sees SERVED |
