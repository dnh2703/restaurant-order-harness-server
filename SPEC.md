# SPEC — Restaurant QR Ordering System

## 1. Overview

Web app for a restaurant: customer scans the QR code at the table → views the menu → orders dishes; the kitchen receives & updates dish statuses; the cashier finalizes the bill/payment; the admin manages the menu/tables/reports.

**Stack**
- BE: Elysia (Bun), Clean Architecture (Domain / Application / Infrastructure / Presentation).
- FE: TanStack Start, Feature-Sliced Design (app / pages / widgets / features / entities / shared), Tailwind CSS.
- DB: **Neon** (serverless Postgres, branching + scale-to-zero).
- Auth: **built in-house on the BE** — JWT access token (~15 min) + refresh token (stored in DB, revocable). `@elysiajs/jwt`, password hashing with argon2/bcrypt.
- Realtime (kitchen/cashier/customer status): **SSE from Elysia**, sourced from Postgres `LISTEN/NOTIFY`. MVP can fall back to polling every 2-3s. (Neon has no built-in realtime like Supabase → realtime is handled on the BE.)

**Actors**
- `Customer` (guest, no login required, enters via the table QR token).
- `Kitchen` (cook).
- `Cashier`.
- `Admin` (restaurant owner/manager).

---

## 2. Epics & User Stories

Story format: **As a [actor], I want [action] so that [value]**. AC = Acceptance Criteria.

### EPIC 1 — QR access & table session
Goal: when a customer scans the QR they land on the correct table and open an ordering session.

**US-1.1** As a Customer, I scan a QR to open the menu for the correct table.
- AC: QR contains the table token; access → resolve `table` + create/get the table's `OPEN` `order`.
- AC: invalid/expired token → error screen "Invalid table".

**US-1.2** As a Customer, I see the restaurant name + table number on screen to confirm I'm in the right place.
- AC: header shows restaurant name, table number, session status.

**US-1.3** As an Admin, I create/print a QR for each table.
- AC: each table has a unique token; regenerate token (invalidating the old QR); export QR (PNG/PDF).

---

### EPIC 2 — Menu & browsing dishes (Customer)
**US-2.1** As a Customer, I view the menu by category (dish, image, price, description).
- AC: grouped by category; `unavailable` dishes shown dimmed + a "Sold out" label.

**US-2.2** As a Customer, I search/filter dishes by name or category.
- AC: search by name (diacritic-insensitive); filter by category.

**US-2.3** As a Customer, I view dish details + choose toppings/options/notes.
- AC: option groups (required radio / multi-select checkbox); free-text note; price updates based on options.

---

### EPIC 3 — Cart & ordering (Customer)
**US-3.1** As a Customer, I add dishes to the cart with quantity + note.
- AC: increase/decrease quantity; remove item; running subtotal in realtime.

**US-3.2** As a Customer, I send the order to the kitchen.
- AC: submit → create `order_items` with status `PENDING`; cart clears; confirmation shown.
- AC: allow ordering more multiple times within the same session (append to the `OPEN` order).

**US-3.3** As a Customer, I view the status of dishes I've ordered.
- AC: list updates in realtime: `PENDING → COOKING → SERVED`.

**US-3.4** As a Customer, I call staff / request the bill.
- AC: "Call staff" and "Request bill" buttons → create a notification for the cashier.

---

### EPIC 4 — Kitchen screen (Kitchen)
**US-4.1** As Kitchen, I view the queue of dishes to make in realtime.
- AC: show `PENDING`/`COOKING` items with table, quantity, note, options; sorted by order time.

**US-4.2** As Kitchen, I update a dish's status.
- AC: transition `PENDING→COOKING→SERVED`; push realtime updates to customer + cashier.

**US-4.3** As Kitchen, I mark a dish as temporarily sold out.
- AC: set `unavailable` → immediately hide from the customer menu.

---

### EPIC 5 — Cashier & Payment (Cashier)
**US-5.1** As a Cashier, I view the list of open tables + total amounts.
- AC: grid/list of tables by status; "bill requested" badge.

**US-5.2** As a Cashier, I view the bill detail for a table.
- AC: list items, unit price, quantity, line total, discount, total.

**US-5.3** As a Cashier, I apply discounts / surcharges.
- AC: discount by % or fixed amount; record reason; total updates.

**US-5.4** As a Cashier, I finalize payment & close the table session.
- AC: choose method (cash/transfer/card); order → `PAID`; session closes, table returns to `EMPTY`.
- AC: create a `payment` record; print/preview the invoice.

---

### EPIC 6 — Menu administration (Admin)
**US-6.1** As an Admin, I CRUD categories.
**US-6.2** As an Admin, I CRUD dishes (name, price, image, description, category, available).
**US-6.3** As an Admin, I CRUD option groups + options of a dish.
**US-6.4** As an Admin, I CRUD tables (name/number, capacity, QR token).

---

### EPIC 7 — Reports (Admin) *(minimal)*
**US-7.1** As an Admin, I view revenue by day/date range.
**US-7.2** As an Admin, I view top-selling dishes.
- AC: filter by date range; export CSV (optional).

---

### EPIC 8 — Auth & authorization (staff, built in-house on BE)
**US-8.1** As an Admin/Kitchen/Cashier, I log in to access internal screens.
- AC: email/password; verify with argon2/bcrypt.
- AC: return an **access token** (JWT, ~15 min, containing `userId`, `role`, `restaurantId`) + a **refresh token** (~7-30 days).
- AC: refresh token stored in DB (`refresh_tokens`) to allow revocation; access token is stateless and not stored.
**US-8.2** As staff, I refresh the access token when it expires.
- AC: `POST /auth/refresh` reads the refresh token → issues a new access token; a revoked refresh token → 401.
**US-8.3** As staff, I log out.
- AC: revoke the corresponding refresh token (delete/mark `revoked`).
**US-8.4** As an Admin, I manage staff accounts + roles.
- AC: RBAC via `authGuard` reading `role` from the JWT: `ADMIN` full; `KITCHEN` only the kitchen screen; `CASHIER` only the cashier screen.
- AC: customer routes (QR) require no auth (skip guard).

---

### EPIC 9 — Realtime (SSE via Elysia)
Goal: kitchen/cashier/customer see updates immediately, with no reload.

**US-9.1** As Kitchen/Cashier, I receive realtime updates of the queue & statuses.
- AC: client opens SSE `GET /stream/restaurant/:id` (staff, authenticated); server pushes an event when an order_item/order/service_request changes.
- AC: mechanism: use-case writes to DB → Postgres `NOTIFY` → Elysia listener → broadcast SSE to clients of the correct restaurant.
**US-9.2** As a Customer, I see dish statuses update in realtime.
- AC: SSE `GET /stream/order/:orderId` (by QR token, no auth required); push when an item changes `PENDING→COOKING→SERVED`.
**US-9.3** Fallback.
- AC: SSE failure/unsupported → FE polls every 2-3s. (Note on Neon scale-to-zero: keep `LISTEN` on the BE, don't let clients `LISTEN` directly.)

---

## 3. Database Schema (Neon / PostgreSQL)

> Conventions: `id uuid pk default gen_random_uuid()`, `created_at/updated_at timestamptz`. Money stored as `integer` (VND).

### restaurants
| col | type | note |
|---|---|---|
| id | uuid pk | |
| name | text | |
| address | text null | |
| phone | text null | |

### users (staff)
| col | type | note |
|---|---|---|
| id | uuid pk | |
| restaurant_id | uuid fk→restaurants | |
| email | text unique | |
| password_hash | text | |
| name | text | |
| role | enum(`ADMIN`,`KITCHEN`,`CASHIER`) | |
| is_active | bool default true | |

### refresh_tokens
| col | type | note |
|---|---|---|
| id | uuid pk | |
| user_id | uuid fk→users | |
| token_hash | text | hash of the refresh token |
| expires_at | timestamptz | |
| revoked | bool default false | logout/password change/ban |
| created_at | timestamptz | |

### tables
| col | type | note |
|---|---|---|
| id | uuid pk | |
| restaurant_id | uuid fk | |
| name | text | e.g. "Table 5" |
| capacity | int null | |
| qr_token | text unique | used to resolve QR |
| status | enum(`EMPTY`,`OCCUPIED`) default EMPTY | |

### categories
| col | type | note |
|---|---|---|
| id | uuid pk | |
| restaurant_id | uuid fk | |
| name | text | |
| sort_order | int default 0 | |

### menu_items
| col | type | note |
|---|---|---|
| id | uuid pk | |
| category_id | uuid fk→categories | |
| name | text | |
| description | text null | |
| price | int | VND |
| image_url | text null | |
| is_available | bool default true | |
| sort_order | int default 0 | |

### option_groups
| col | type | note |
|---|---|---|
| id | uuid pk | |
| menu_item_id | uuid fk→menu_items | |
| name | text | e.g. "Size", "Topping" |
| type | enum(`SINGLE`,`MULTI`) | |
| is_required | bool default false | |

### options
| col | type | note |
|---|---|---|
| id | uuid pk | |
| option_group_id | uuid fk→option_groups | |
| name | text | |
| price_delta | int default 0 | added to the price |

### orders (table session)
| col | type | note |
|---|---|---|
| id | uuid pk | |
| restaurant_id | uuid fk | |
| table_id | uuid fk→tables | |
| status | enum(`OPEN`,`PAID`,`CANCELLED`) default OPEN | |
| subtotal | int default 0 | |
| discount_amount | int default 0 | |
| discount_reason | text null | |
| total | int default 0 | |
| opened_at | timestamptz | |
| closed_at | timestamptz null | |

> Constraint: at most 1 `OPEN` order per table (partial unique index on `table_id WHERE status='OPEN'`).

### order_items
| col | type | note |
|---|---|---|
| id | uuid pk | |
| order_id | uuid fk→orders | |
| menu_item_id | uuid fk→menu_items | |
| name_snapshot | text | name at order time |
| unit_price | int | price at order time (incl. options) |
| quantity | int | |
| note | text null | |
| status | enum(`PENDING`,`COOKING`,`SERVED`,`CANCELLED`) default PENDING | |
| created_at | timestamptz | sorts the kitchen queue |

### order_item_options (snapshot of chosen options)
| col | type | note |
|---|---|---|
| id | uuid pk | |
| order_item_id | uuid fk→order_items | |
| option_name | text | snapshot |
| price_delta | int | snapshot |

### payments
| col | type | note |
|---|---|---|
| id | uuid pk | |
| order_id | uuid fk→orders | |
| method | enum(`CASH`,`TRANSFER`,`CARD`) | |
| amount | int | |
| cashier_id | uuid fk→users | |
| paid_at | timestamptz | |

### service_requests (call staff / request bill)
| col | type | note |
|---|---|---|
| id | uuid pk | |
| order_id | uuid fk→orders | |
| type | enum(`CALL_STAFF`,`REQUEST_BILL`) | |
| status | enum(`OPEN`,`DONE`) default OPEN | |
| created_at | timestamptz | |

**Main indexes:** `tables(qr_token)`, `orders(table_id) where status=OPEN`, `order_items(order_id,status)`, `order_items(status,created_at)` (kitchen queue), `payments(order_id)`, `refresh_tokens(user_id) where revoked=false`.

---

## 4. Suggested structure (summary)

**BE Clean Arch**
```
src/
  domain/        entities, value-objects, repo interfaces (Auth, Order, ...)
  application/   use-cases (Login, Refresh, Logout, CreateOrder, AddItems,
                 UpdateItemStatus, CheckoutOrder, ...)
  infrastructure/ db (drizzle/prisma) → Neon, repo impl,
                 JwtService, PasswordHasher, RealtimeBroker (LISTEN/NOTIFY→SSE)
  presentation/  elysia routes/controllers, dto, authGuard (verify JWT + RBAC),
                 SSE endpoints (/stream/...)
```

**FE FSD**
```
src/
  app/       providers, router (TanStack Start), styles
  pages/     customer-menu, kitchen-board, cashier, admin-*
  widgets/   menu-list, cart, kitchen-queue, bill-panel
  features/  add-to-cart, submit-order, update-item-status, checkout
  entities/  menu-item, order, table, payment
  shared/    api client, ui kit, tailwind config, hooks, lib
```
