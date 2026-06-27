# Design — US-002 Data Model + Migrations

## Domain Model

Entities mirror `docs/product/data-model.md`: `restaurants`, `users`,
`refresh_tokens`, `tables`, `categories`, `menu_items`, `option_groups`, `options`,
`orders`, `order_items`, `order_item_options`, `payments`, `service_requests`.

Key value rules encoded at the schema level:

- Money columns are `integer` (VND).
- Enums: `user.role`, `table.status`, `option_group.type`, `order.status`,
  `order_item.status`, `payment.method`, `service_request.type`, `service_request.status`.
- Snapshot columns on `order_items` / `order_item_options` are plain columns, not FKs
  to live names/prices.

## Application Flow

No use-cases in this story. Provide a typed Drizzle client (`infrastructure/db`) and a
`seed` routine.

## Interface Contract

No HTTP contract changes. Output is the migration set + schema module other stories
import.

## Data Model

- Drizzle `pgTable` definitions + `pgEnum` for each enum.
- Foreign keys with appropriate `on delete` behavior (e.g. `order_items` cascade with
  `orders`; restrict deleting a `table`/`menu_item` referenced by history — prefer soft
  rules over destructive cascades for billed data).
- Indexes:
  - `tables(qr_token)` unique.
  - partial unique `orders(table_id) WHERE status='OPEN'`.
  - `order_items(order_id, status)`, `order_items(status, created_at)`.
  - `payments(order_id)`, partial `refresh_tokens(user_id) WHERE revoked=false`.

## UI / Platform Impact

None directly. Migrations must apply cleanly on a Neon branch (test branch first, per
the Neon branching workflow) before the primary branch.

## Observability

- Migration runner logs applied migrations.
- Seed logs created row counts for test determinism.

## Alternatives Considered

1. Prisma instead of Drizzle — rejected; Drizzle chosen in decision 0008 (lighter,
   SQL-first, first-class Neon support, `drizzle-zod` for validation).
2. Enforcing one-open-order in app code only — rejected; the partial unique index makes
   the invariant true at the database level under concurrency.
