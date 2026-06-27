# Data Model — Restaurant QR Ordering

Source of truth for the database schema (Neon / PostgreSQL, accessed via Drizzle ORM).
This doc is the living contract; `SPEC.md` is the original input.

## Conventions

- Primary keys: `id uuid pk default gen_random_uuid()`.
- Timestamps: `created_at` / `updated_at` are `timestamptz`.
- Money: stored as `integer` in VND (no decimals). Never use float for money.
- Enums: Postgres enum types, uppercase values.
- All tenant-owned rows carry `restaurant_id` for future multi-restaurant scope.

## Tables

### restaurants

`id` · `name` · `address?` · `phone?`

### users (staff)

`id` · `restaurant_id → restaurants` · `email unique` · `password_hash` · `name` ·
`role enum(ADMIN, KITCHEN, CASHIER)` · `is_active bool default true`

### refresh_tokens

`id` · `user_id → users` · `token_hash` (hash of the refresh token) ·
`expires_at` · `revoked bool default false` · `created_at`

### tables

`id` · `restaurant_id → restaurants` · `name` (e.g. "Table 5") · `capacity?` ·
`qr_token text unique` · `status enum(EMPTY, OCCUPIED) default EMPTY`

### categories

`id` · `restaurant_id → restaurants` · `name` · `sort_order int default 0`

### menu_items

`id` · `category_id → categories` · `name` · `description?` · `price int` (VND) ·
`image_url?` · `is_available bool default true` · `sort_order int default 0`

### option_groups

`id` · `menu_item_id → menu_items` · `name` (e.g. "Size", "Topping") ·
`type enum(SINGLE, MULTI)` · `is_required bool default false`

### options

`id` · `option_group_id → option_groups` · `name` · `price_delta int default 0`

### orders (table session)

`id` · `restaurant_id → restaurants` · `table_id → tables` ·
`status enum(OPEN, PAID, CANCELLED) default OPEN` · `subtotal int default 0` ·
`discount_amount int default 0` · `discount_reason?` · `total int default 0` ·
`opened_at` · `closed_at?`

### order_items

`id` · `order_id → orders` · `menu_item_id → menu_items` ·
`name_snapshot` (name at order time) · `unit_price int` (price at order time, incl.
options) · `quantity int` · `note?` ·
`status enum(PENDING, COOKING, SERVED, CANCELLED) default PENDING` · `created_at`

### order_item_options (snapshot of chosen options)

`id` · `order_item_id → order_items` · `option_name` (snapshot) ·
`price_delta int` (snapshot)

### payments

`id` · `order_id → orders` · `method enum(CASH, TRANSFER, CARD)` · `amount int` ·
`cashier_id → users` · `paid_at`

### service_requests (call staff / request bill)

`id` · `order_id → orders` · `type enum(CALL_STAFF, REQUEST_BILL)` ·
`status enum(OPEN, DONE) default OPEN` · `created_at`

## Invariants

- **At most one `OPEN` order per table.** Enforce with a partial unique index on
  `orders(table_id) WHERE status = 'OPEN'`.
- Order totals are derived: `subtotal = Σ(order_items.unit_price × quantity)` over
  non-`CANCELLED` items; `total = subtotal − discount_amount` (clamped at ≥ 0).
- `order_items` capture **snapshots** (`name_snapshot`, `unit_price`, option name +
  `price_delta`) so later menu edits never rewrite historical bills.
- A `table` is `OCCUPIED` iff it has an `OPEN` order; checkout returns it to `EMPTY`.
- `refresh_tokens.token_hash` stores a hash, never the raw token.

## Indexes

| Index | Purpose |
| --- | --- |
| `tables(qr_token)` | QR resolution |
| `orders(table_id) WHERE status='OPEN'` | unique open session lookup |
| `order_items(order_id, status)` | bill + per-order status |
| `order_items(status, created_at)` | kitchen queue ordering |
| `payments(order_id)` | bill reconciliation |
| `refresh_tokens(user_id) WHERE revoked=false` | active session lookup |

## Migration Policy

- All schema changes go through Drizzle migrations checked into the repo.
- Test migrations on a Neon branch before applying to the primary branch
  (see the invariants above, decision `0008-restaurant-qr-architecture`, and the Neon
  branching skill).
- Destructive migrations are high-risk and require a decision record.
