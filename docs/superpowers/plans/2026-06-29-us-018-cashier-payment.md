# US-018 Cashier & Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a `CASHIER`/`ADMIN` the close-out half of the dining loop — list open tables, view a bill, apply a discount, and finalize payment (order `OPEN→PAID`, record a `payment`, free the table) — concurrency-safe so a double-submit can never produce two payments.

**Architecture:** Three thin tenant-scoped use-cases per the established pattern (`src/application/cashier/*`), mounted on one Elysia route module (`/api/cashier`, guarded `['CASHIER','ADMIN']`). The money-critical close-out uses the codebase's conditional-update gate (mirroring kitchen `advance-item-status`): a single `UPDATE … WHERE status='OPEN' RETURNING` claims the order atomically; a 0-row result disambiguates to `404 ORDER_NOT_FOUND` vs `409 ORDER_NOT_OPEN`. No multi-statement transactions (Neon transaction-mode pooler), no schema/migration changes.

**Tech Stack:** Bun + Elysia + Drizzle ORM (PostgreSQL/Neon), TypeBox route validation, `bun:test`. Spec: `docs/superpowers/specs/2026-06-29-us-018-cashier-payment-design.md`.

## Global Constraints

- Money is `integer` VND — never float. `total = max(subtotal − discountAmount, 0)`.
- `restaurantId` ALWAYS comes from `auth.restaurantId`; never from request body/params.
- Cross-tenant / missing order id → `404 ORDER_NOT_FOUND` (existence never disclosed).
- `payments.amount` is server-authoritative (`= orders.total` at the gate); never client-supplied.
- Use-cases take a `Database` as the first arg (autocommit; no multi-statement transactions).
- Envelopes: success `{ data: … }`, error `{ error: { code, message, details? } }`.
- Integration suites self-skip when the DB is unreachable/unmigrated via `probeMigratedDb()`; each DB test passes `DB_TIMEOUT_MS`, `beforeAll` uses `WARMUP_TIMEOUT_MS`.
- Run the full suite with `bun test`; typecheck `bun run typecheck`; lint `bun run lint` (or the scripts in `package.json`). All must be green before a task is done.

---

## File Structure

- `src/application/cashier/list-open-tables.ts` — `listOpenTables()` + `OpenTableView` (read).
- `src/application/cashier/get-bill.ts` — `getBill()` tenant-scoped bill detail (read).
- `src/application/cashier/discount.ts` — `resolveDiscountAmount()` pure math + `DiscountInput`.
- `src/application/cashier/order-guard.ts` — `throwOrderGateFailure()` shared 404/409 disambiguation.
- `src/application/cashier/apply-discount.ts` — `applyDiscount()` (gate write).
- `src/application/cashier/checkout-order.ts` — `checkoutOrder()` (money-critical gate write).
- `src/presentation/http/routes/cashier.ts` — Elysia module, built up across Tasks 1–3.
- `src/presentation/http/app.ts` — mount `cashierRoutes`.
- `src/shared/errors/error-catalog.ts` — add `ORDER_NOT_FOUND`, `ORDER_NOT_OPEN`, `INVALID_DISCOUNT`.
- `test/cashier/discount.test.ts` — unit (discount math).
- `test/cashier/cashier-routes.integration.test.ts` — two-tenant HTTP, built up across Tasks 1–3.

---

## Task 1: Read surface — open tables + bill detail

**Files:**
- Modify: `src/shared/errors/error-catalog.ts`
- Create: `src/application/cashier/list-open-tables.ts`
- Create: `src/application/cashier/get-bill.ts`
- Create: `src/presentation/http/routes/cashier.ts`
- Modify: `src/presentation/http/app.ts`
- Test: `test/cashier/cashier-routes.integration.test.ts`

**Interfaces:**
- Consumes: `loadOrder(database, orderId): Promise<OrderView>` and `OrderView` from `src/application/orders/get-order.ts`; `authGuard`; `db`; `AppError`.
- Produces:
  - `OpenTableView = { orderId: string; tableId: string; tableName: string; subtotal: number; discountAmount: number; total: number; openedAt: string; itemCount: number }`
  - `listOpenTables(database: Database, restaurantId: string): Promise<OpenTableView[]>`
  - `getBill(database: Database, restaurantId: string, orderId: string): Promise<OrderView>`
  - `cashierRoutes` (Elysia, prefix `/cashier`).

- [ ] **Step 1: Add the `ORDER_NOT_FOUND` error code**

In `src/shared/errors/error-catalog.ts`, add a block before `// Infrastructure`:

```ts
  // Cashier & payment (US-018)
  ORDER_NOT_FOUND: { status: 404, message: 'Order not found' },
```

- [ ] **Step 2: Write `listOpenTables`**

Create `src/application/cashier/list-open-tables.ts`:

```ts
import { and, asc, eq, sql } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orderItems, orders, tables } from '../../infrastructure/database/schema'

/** One occupied table's open order with its running totals (US-5.1). */
export interface OpenTableView {
  orderId: string
  tableId: string
  tableName: string
  subtotal: number
  discountAmount: number
  total: number
  openedAt: string
  itemCount: number
}

/**
 * List a restaurant's OPEN orders (one per occupied table) with running totals, oldest session
 * first. `itemCount` is a correlated count of non-CANCELLED items (the billed lines). Tenancy is a
 * direct filter on `orders.restaurantId`; one explicit-column read joined to `tables`, no N+1.
 */
export async function listOpenTables(
  database: Database,
  restaurantId: string,
): Promise<OpenTableView[]> {
  const itemCount = sql<number>`(
    SELECT COUNT(*) FROM ${orderItems}
    WHERE ${orderItems.orderId} = ${orders.id} AND ${orderItems.status} <> 'CANCELLED'
  )`

  const rows = await database
    .select({
      orderId: orders.id,
      tableId: tables.id,
      tableName: tables.name,
      subtotal: orders.subtotal,
      discountAmount: orders.discountAmount,
      total: orders.total,
      openedAt: orders.openedAt,
      itemCount,
    })
    .from(orders)
    .innerJoin(tables, eq(tables.id, orders.tableId))
    .where(and(eq(orders.restaurantId, restaurantId), eq(orders.status, 'OPEN')))
    .orderBy(asc(orders.openedAt))

  return rows.map((r) => ({
    orderId: r.orderId,
    tableId: r.tableId,
    tableName: r.tableName,
    subtotal: r.subtotal,
    discountAmount: r.discountAmount,
    total: r.total,
    openedAt: r.openedAt.toISOString(),
    itemCount: Number(r.itemCount),
  }))
}
```

- [ ] **Step 3: Write `getBill`**

Create `src/application/cashier/get-bill.ts`:

```ts
import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orders } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { loadOrder, type OrderView } from '../orders/get-order'

/**
 * Full bill detail for one order (US-5.2). Tenant-scoped existence guard first — a missing or
 * cross-tenant id surfaces as `404 ORDER_NOT_FOUND` (existence never disclosed) — then reuse the
 * US-007 `loadOrder` read model (items, unit price, qty, option snapshots, discount, total). Works
 * for any order status (you can view a PAID bill).
 */
export async function getBill(
  database: Database,
  restaurantId: string,
  orderId: string,
): Promise<OrderView> {
  const [row] = await database
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.restaurantId, restaurantId)))
    .limit(1)
  if (!row) throw new AppError('ORDER_NOT_FOUND')
  return loadOrder(database, orderId)
}
```

- [ ] **Step 4: Create the cashier route module (GET endpoints only)**

Create `src/presentation/http/routes/cashier.ts`:

```ts
import { Elysia, t } from 'elysia'

import { getBill } from '../../../application/cashier/get-bill'
import { listOpenTables } from '../../../application/cashier/list-open-tables'
import { db } from '../../../infrastructure/database/client'
import { authGuard } from '../plugins/auth-guard'

const idParams = t.Object({ id: t.String({ format: 'uuid' }) })

const openTable = t.Object({
  orderId: t.String({ format: 'uuid' }),
  tableId: t.String({ format: 'uuid' }),
  tableName: t.String(),
  subtotal: t.Integer(),
  discountAmount: t.Integer(),
  total: t.Integer(),
  openedAt: t.String(),
  itemCount: t.Integer(),
})

/**
 * Cashier & payment API (E08 / SPEC EPIC 5). Every route is guarded `['CASHIER','ADMIN']` and
 * tenant-scoped: the restaurant always comes from `auth.restaurantId`, never the body/params.
 */
export const cashierRoutes = new Elysia({ prefix: '/cashier' })
  .use(authGuard)
  .guard({ auth: ['CASHIER', 'ADMIN'] })
  .get(
    '/tables',
    async ({ auth }) => {
      const tables = await listOpenTables(db, auth.restaurantId)
      return { data: { tables } }
    },
    {
      detail: { tags: ['Cashier'], summary: 'List open tables with running totals' },
      response: { 200: t.Object({ data: t.Object({ tables: t.Array(openTable) }) }) },
    },
  )
  .get(
    '/orders/:id',
    async ({ auth, params }) => {
      const order = await getBill(db, auth.restaurantId, params.id)
      return { data: { order } }
    },
    {
      params: idParams,
      detail: { tags: ['Cashier'], summary: 'Bill detail for one order' },
    },
  )
```

(The bill-detail response intentionally omits a TypeBox `response` schema — `OrderView` is large and already validated by its producer; mirrors keeping route schemas lean. The list endpoint keeps its schema.)

- [ ] **Step 5: Mount the route**

In `src/presentation/http/app.ts`: add the import (alphabetical, after `./routes/auth`):

```ts
import { cashierRoutes } from './routes/cashier'
```

and mount it in the chain (after `.use(authRoutes)`, before `.use(staffRoutes)` is fine — order is not semantically significant):

```ts
  .use(cashierRoutes)
```

- [ ] **Step 6: Write the failing integration test (read surface + RBAC + tenancy)**

Create `test/cashier/cashier-routes.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { hashPassword } from '../../src/infrastructure/auth/password'
import { db } from '../../src/infrastructure/database/client'
import { orderItems, orders, restaurants, tables, users } from '../../src/infrastructure/database/schema'
import { app } from '../../src/presentation/http/app'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'
import { errorCode } from '../support/http'

let schemaAvailable = false
const password = 'cashier-pw-us018'
const cashierAEmail = `cashier-a-${randomUUID()}@us018.test`
const adminAEmail = `admin-a-${randomUUID()}@us018.test`
const cashierBEmail = `cashier-b-${randomUUID()}@us018.test`
let restaurantAId = ''
let restaurantBId = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const passwordHash = await hashPassword(password)
  const [a] = await db.insert(restaurants).values({ name: 'US-018 A' }).returning({ id: restaurants.id })
  restaurantAId = a!.id
  const [b] = await db.insert(restaurants).values({ name: 'US-018 B' }).returning({ id: restaurants.id })
  restaurantBId = b!.id
  await db.insert(users).values([
    { restaurantId: restaurantAId, email: cashierAEmail, passwordHash, name: 'Cashier A', role: 'CASHIER' },
    { restaurantId: restaurantAId, email: adminAEmail, passwordHash, name: 'Admin A', role: 'ADMIN' },
    { restaurantId: restaurantBId, email: cashierBEmail, passwordHash, name: 'Cashier B', role: 'CASHIER' },
  ])
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable) return
  for (const rid of [restaurantAId, restaurantBId].filter(Boolean)) {
    await db.delete(orders).where(eq(orders.restaurantId, rid)) // cascades order_items + payments? payments are NOT cascade — delete first
    await db.delete(tables).where(eq(tables.restaurantId, rid))
    await db.delete(users).where(eq(users.restaurantId, rid))
    await db.delete(restaurants).where(eq(restaurants.id, rid))
  }
}, DB_TIMEOUT_MS)

async function tokenFor(email: string): Promise<string> {
  const res = await app.handle(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  )
  const { data } = (await res.json()) as { data: { accessToken: string } }
  return data.accessToken
}

function req(path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<Response> {
  const headers: Record<string, string> = {}
  if (init.token) headers.authorization = `Bearer ${init.token}`
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  return app.handle(
    new Request(`http://localhost/api${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    }),
  )
}

/** Seed an OPEN order for restaurant A with one priced item; returns ids + totals. */
async function seedOpenOrder(opts: { subtotal: number; unitPrice: number; quantity: number }) {
  const [table] = await db
    .insert(tables)
    .values({ restaurantId: restaurantAId, name: `T-${randomUUID()}`, qrToken: `tok-${randomUUID()}`, status: 'OCCUPIED' })
    .returning({ id: tables.id, name: tables.name })
  const [order] = await db
    .insert(orders)
    .values({ restaurantId: restaurantAId, tableId: table!.id, status: 'OPEN', subtotal: opts.subtotal, total: opts.subtotal })
    .returning({ id: orders.id })
  await db.insert(orderItems).values({
    orderId: order!.id,
    menuItemId: randomUUID(), // FK is not enforced against menu_items in this seed path? it IS — see note
    nameSnapshot: 'Phở',
    unitPrice: opts.unitPrice,
    quantity: opts.quantity,
  })
  return { tableId: table!.id, tableName: table!.name, orderId: order!.id }
}

describe('cashier read surface', () => {
  it(
    'rejects a missing token (401) and a non-staff path is guarded',
    async () => {
      if (!schemaAvailable) return
      expect((await req('/cashier/tables')).status).toBe(401)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'lists this tenant\'s open tables with running totals (cashier role allowed)',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(cashierAEmail)
      const seeded = await seedOpenOrder({ subtotal: 50000, unitPrice: 50000, quantity: 1 })
      const res = await req('/cashier/tables', { token })
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as { data: { tables: Array<{ orderId: string; total: number; itemCount: number }> } }
      const row = data.tables.find((t) => t.orderId === seeded.orderId)
      expect(row).toBeDefined()
      expect(row!.total).toBe(50000)
      expect(row!.itemCount).toBe(1)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'returns bill detail for an order, and 404 ORDER_NOT_FOUND cross-tenant',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(cashierAEmail)
      const seeded = await seedOpenOrder({ subtotal: 30000, unitPrice: 15000, quantity: 2 })
      const ok = await req(`/cashier/orders/${seeded.orderId}`, { token })
      expect(ok.status).toBe(200)
      const { data } = (await ok.json()) as { data: { order: { id: string; total: number; items: unknown[] } } }
      expect(data.order.id).toBe(seeded.orderId)
      expect(data.order.items.length).toBe(1)

      const bToken = await tokenFor(cashierBEmail)
      const cross = await req(`/cashier/orders/${seeded.orderId}`, { token: bToken })
      expect(cross.status).toBe(404)
      expect(await errorCode(cross)).toBe('ORDER_NOT_FOUND')
    },
    DB_TIMEOUT_MS,
  )
})
```

> NOTE for the implementer: `order_items.menu_item_id` is a non-null FK → `menu_items.id`. The `randomUUID()` placeholder above will violate the FK. Replace it by first seeding a real `categories` + `menu_items` row for restaurant A in `seedOpenOrder` (insert a category, then a menu item, use its id), OR seed the order via the US-007 path. Use the direct-insert approach: add a category + menu item in `beforeAll`, store `menuItemAId`, and pass it into `orderItems`. Adjust `afterAll` to delete `menu_items`/`categories` for the tenant before `restaurants`. Verify against the live DB.

- [ ] **Step 7: Run the test — verify it FAILS**

Run: `bun test test/cashier/cashier-routes.integration.test.ts`
Expected (with a migrated DB): FAIL — `/cashier/tables` 401 passes but the list/bill assertions fail because the route doesn't exist yet (404) until Steps 2–5 are in. (If the DB is unreachable the suite self-skips — run `bun run db:migrate` against your Neon branch first so the tests actually execute.)

- [ ] **Step 8: Run the test — verify it PASSES**

After Steps 1–5 are implemented:
Run: `bun test test/cashier/cashier-routes.integration.test.ts`
Expected: PASS (all 3 `it` blocks).

- [ ] **Step 9: Typecheck, lint, full suite**

Run: `bun run typecheck && bun run lint && bun test`
Expected: typecheck clean, lint clean, full suite green (DB-backed suites self-skip if no DB).

- [ ] **Step 10: Commit**

```bash
git add src/shared/errors/error-catalog.ts src/application/cashier/list-open-tables.ts \
  src/application/cashier/get-bill.ts src/presentation/http/routes/cashier.ts \
  src/presentation/http/app.ts test/cashier/cashier-routes.integration.test.ts
git commit -m "feat(us-018): cashier read surface — open tables + bill detail"
```

---

## Task 2: Apply discount (PERCENT / FIXED)

**Files:**
- Modify: `src/shared/errors/error-catalog.ts`
- Create: `src/application/cashier/discount.ts`
- Create: `src/application/cashier/order-guard.ts`
- Create: `src/application/cashier/apply-discount.ts`
- Modify: `src/presentation/http/routes/cashier.ts`
- Test: `test/cashier/discount.test.ts` (unit)
- Test: `test/cashier/cashier-routes.integration.test.ts` (append)

**Interfaces:**
- Consumes: `loadOrder`/`OrderView`; `db`; `AppError`; the Task 1 route module.
- Produces:
  - `DiscountInput = { type: 'PERCENT' | 'FIXED'; value: number; reason?: string | null }`
  - `resolveDiscountAmount(subtotal: number, input: { type: 'PERCENT' | 'FIXED'; value: number }): number` (throws `AppError('INVALID_DISCOUNT')`)
  - `throwOrderGateFailure(database: Database, restaurantId: string, orderId: string): Promise<never>`
  - `applyDiscount(database: Database, restaurantId: string, orderId: string, input: DiscountInput): Promise<OrderView>`

- [ ] **Step 1: Add the discount/conflict error codes**

In `src/shared/errors/error-catalog.ts`, extend the `// Cashier & payment (US-018)` block:

```ts
  ORDER_NOT_OPEN: { status: 409, message: 'Order is not open' },
  INVALID_DISCOUNT: { status: 422, message: 'Discount value is out of range' },
```

- [ ] **Step 2: Write the failing unit test for discount math**

Create `test/cashier/discount.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'

import { resolveDiscountAmount } from '../../src/application/cashier/discount'

describe('resolveDiscountAmount', () => {
  it('computes a PERCENT discount as round(subtotal * value / 100)', () => {
    expect(resolveDiscountAmount(100000, { type: 'PERCENT', value: 10 })).toBe(10000)
    expect(resolveDiscountAmount(33333, { type: 'PERCENT', value: 10 })).toBe(3333) // round
  })

  it('returns a FIXED discount as the raw VND amount', () => {
    expect(resolveDiscountAmount(100000, { type: 'FIXED', value: 25000 })).toBe(25000)
  })

  it('throws INVALID_DISCOUNT for a percent over 100 or a negative value', () => {
    expect(() => resolveDiscountAmount(100000, { type: 'PERCENT', value: 101 })).toThrow('out of range')
    expect(() => resolveDiscountAmount(100000, { type: 'FIXED', value: -1 })).toThrow('out of range')
  })
})
```

- [ ] **Step 3: Run the unit test — verify it FAILS**

Run: `bun test test/cashier/discount.test.ts`
Expected: FAIL — `Cannot find module '.../cashier/discount'`.

- [ ] **Step 4: Implement the pure discount math**

Create `src/application/cashier/discount.ts`:

```ts
import { AppError } from '../../shared/errors'

/** Discount request body shape (US-5.3). `value` is a percent (0–100) or a VND amount. */
export interface DiscountInput {
  type: 'PERCENT' | 'FIXED'
  value: number
  reason?: string | null
}

/**
 * Resolve a discount request to an absolute VND `discount_amount`. `PERCENT` → `round(subtotal *
 * value / 100)`; `FIXED` → `value`. Throws `AppError('INVALID_DISCOUNT')` (422) for a non-integer
 * or negative value, or a percent above 100. Pure (DB-free) so the money math is unit-testable.
 */
export function resolveDiscountAmount(
  subtotal: number,
  input: { type: 'PERCENT' | 'FIXED'; value: number },
): number {
  if (!Number.isInteger(input.value) || input.value < 0) {
    throw new AppError('INVALID_DISCOUNT')
  }
  if (input.type === 'PERCENT') {
    if (input.value > 100) throw new AppError('INVALID_DISCOUNT')
    return Math.round((subtotal * input.value) / 100)
  }
  return input.value
}
```

- [ ] **Step 5: Run the unit test — verify it PASSES**

Run: `bun test test/cashier/discount.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Write the shared gate-failure disambiguator**

Create `src/application/cashier/order-guard.ts`:

```ts
import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orders } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'

/**
 * Map a 0-row result from a tenant + `status='OPEN'` conditional UPDATE to the right error: a
 * tenant-scoped read tells us whether the order is missing/cross-tenant (`ORDER_NOT_FOUND`, 404)
 * or simply not OPEN (`ORDER_NOT_OPEN`, 409). Always throws — return type is `never`.
 */
export async function throwOrderGateFailure(
  database: Database,
  restaurantId: string,
  orderId: string,
): Promise<never> {
  const [row] = await database
    .select({ status: orders.status })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.restaurantId, restaurantId)))
    .limit(1)
  if (!row) throw new AppError('ORDER_NOT_FOUND')
  throw new AppError('ORDER_NOT_OPEN')
}
```

- [ ] **Step 7: Implement `applyDiscount`**

Create `src/application/cashier/apply-discount.ts`:

```ts
import { and, eq, sql } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orders } from '../../infrastructure/database/schema'
import { loadOrder, type OrderView } from '../orders/get-order'
import { type DiscountInput, resolveDiscountAmount } from './discount'
import { throwOrderGateFailure } from './order-guard'

/**
 * Apply a discount to an OPEN order (US-5.3) and recompute its total. PERCENT is computed from the
 * order's current `subtotal`. The write is a tenant + `status='OPEN'` conditional UPDATE that also
 * re-floors `total = max(subtotal - discount, 0)`; a 0-row result disambiguates to
 * `404 ORDER_NOT_FOUND` / `409 ORDER_NOT_OPEN`. An out-of-range value throws `422 INVALID_DISCOUNT`
 * before any write.
 */
export async function applyDiscount(
  database: Database,
  restaurantId: string,
  orderId: string,
  input: DiscountInput,
): Promise<OrderView> {
  const [open] = await database
    .select({ subtotal: orders.subtotal })
    .from(orders)
    .where(
      and(eq(orders.id, orderId), eq(orders.restaurantId, restaurantId), eq(orders.status, 'OPEN')),
    )
    .limit(1)
  if (!open) await throwOrderGateFailure(database, restaurantId, orderId)

  const discountAmount = resolveDiscountAmount(open!.subtotal, input)

  const updated = await database
    .update(orders)
    .set({
      discountAmount,
      discountReason: input.reason ?? null,
      total: sql`GREATEST(${orders.subtotal} - ${discountAmount}, 0)`,
    })
    .where(
      and(eq(orders.id, orderId), eq(orders.restaurantId, restaurantId), eq(orders.status, 'OPEN')),
    )
    .returning({ id: orders.id })
  if (!updated[0]) await throwOrderGateFailure(database, restaurantId, orderId)

  return loadOrder(database, orderId)
}
```

- [ ] **Step 8: Add the discount route**

In `src/presentation/http/routes/cashier.ts`: add the import

```ts
import { applyDiscount } from '../../../application/cashier/apply-discount'
```

and chain a `.patch` after the `/orders/:id` GET:

```ts
  .patch(
    '/orders/:id/discount',
    async ({ auth, params, body }) => {
      const order = await applyDiscount(db, auth.restaurantId, params.id, body)
      return { data: { order } }
    },
    {
      params: idParams,
      body: t.Object({
        type: t.Union([t.Literal('PERCENT'), t.Literal('FIXED')]),
        value: t.Integer({ minimum: 0 }),
        reason: t.Optional(t.String()),
      }),
      detail: { tags: ['Cashier'], summary: 'Apply a discount (PERCENT or FIXED)' },
    },
  )
```

- [ ] **Step 9: Append the failing integration test (discount)**

Add to `test/cashier/cashier-routes.integration.test.ts` a new `describe`:

```ts
describe('cashier discount', () => {
  it(
    'applies a PERCENT discount and recomputes the total',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(cashierAEmail)
      const seeded = await seedOpenOrder({ subtotal: 100000, unitPrice: 100000, quantity: 1 })
      const res = await req(`/cashier/orders/${seeded.orderId}/discount`, {
        method: 'PATCH',
        token,
        body: { type: 'PERCENT', value: 10, reason: 'regular' },
      })
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as { data: { order: { discountAmount: number; total: number } } }
      expect(data.order.discountAmount).toBe(10000)
      expect(data.order.total).toBe(90000)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects a percent over 100 with 422 INVALID_DISCOUNT',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(cashierAEmail)
      const seeded = await seedOpenOrder({ subtotal: 100000, unitPrice: 100000, quantity: 1 })
      const res = await req(`/cashier/orders/${seeded.orderId}/discount`, {
        method: 'PATCH',
        token,
        body: { type: 'PERCENT', value: 150 },
      })
      expect(res.status).toBe(422)
      expect(await errorCode(res)).toBe('INVALID_DISCOUNT')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'refuses a discount on a non-OPEN order with 409 ORDER_NOT_OPEN',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(cashierAEmail)
      const seeded = await seedOpenOrder({ subtotal: 100000, unitPrice: 100000, quantity: 1 })
      await db.update(orders).set({ status: 'PAID' }).where(eq(orders.id, seeded.orderId))
      const res = await req(`/cashier/orders/${seeded.orderId}/discount`, {
        method: 'PATCH',
        token,
        body: { type: 'FIXED', value: 5000 },
      })
      expect(res.status).toBe(409)
      expect(await errorCode(res)).toBe('ORDER_NOT_OPEN')
    },
    DB_TIMEOUT_MS,
  )
})
```

- [ ] **Step 10: Run the appended tests — verify they FAIL, then PASS**

Run before Steps 6–8 are wired: `bun test test/cashier/cashier-routes.integration.test.ts` → discount block FAILs (route 404).
After implementing: `bun test test/cashier/cashier-routes.integration.test.ts` → PASS.

- [ ] **Step 11: Typecheck, lint, full suite**

Run: `bun run typecheck && bun run lint && bun test`
Expected: all green.

- [ ] **Step 12: Commit**

```bash
git add src/shared/errors/error-catalog.ts src/application/cashier/discount.ts \
  src/application/cashier/order-guard.ts src/application/cashier/apply-discount.ts \
  src/presentation/http/routes/cashier.ts test/cashier/discount.test.ts \
  test/cashier/cashier-routes.integration.test.ts
git commit -m "feat(us-018): apply discount (PERCENT/FIXED) with OPEN-order gate"
```

---

## Task 3: Finalize payment + close session (money-critical)

**Files:**
- Create: `src/application/cashier/checkout-order.ts`
- Modify: `src/presentation/http/routes/cashier.ts`
- Test: `test/cashier/cashier-routes.integration.test.ts` (append)

**Interfaces:**
- Consumes: `throwOrderGateFailure` (Task 2); `loadOrder`/`OrderView`; `db`; `payments`/`orders`/`tables` schema; `auth.userId` from the guard.
- Produces:
  - `CheckoutResult = { payment: { id: string; method: 'CASH'|'TRANSFER'|'CARD'; amount: number; paidAt: string }; order: OrderView }`
  - `checkoutOrder(database: Database, restaurantId: string, orderId: string, input: { method: 'CASH'|'TRANSFER'|'CARD' }, cashierId: string): Promise<CheckoutResult>`

- [ ] **Step 1: Implement `checkoutOrder` (gate → payment → free table)**

Create `src/application/cashier/checkout-order.ts`:

```ts
import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orders, payments, tables } from '../../infrastructure/database/schema'
import { loadOrder, type OrderView } from '../orders/get-order'
import { throwOrderGateFailure } from './order-guard'

export type PaymentMethod = 'CASH' | 'TRANSFER' | 'CARD'

export interface CheckoutResult {
  payment: { id: string; method: PaymentMethod; amount: number; paidAt: string }
  order: OrderView
}

/**
 * Finalize payment and close a table session (US-5.4). Money-critical:
 *
 *  1. GATE — `UPDATE orders SET status='PAID', closed_at=now() WHERE id AND restaurant_id AND
 *     status='OPEN' RETURNING { tableId, total }`. Exactly one concurrent request can flip
 *     OPEN→PAID; it gets the row (and the authoritative `total`). 0 rows → `throwOrderGateFailure`
 *     (`404 ORDER_NOT_FOUND` / `409 ORDER_NOT_OPEN`). This gate is the double-charge guard.
 *  2. RECORD — insert a `payments` row with `amount = total` (server-authoritative) and
 *     `cashier_id = cashierId`.
 *  3. FREE — `UPDATE tables SET status='EMPTY'` (idempotent; re-converges OCCUPIED-iff-OPEN).
 *
 * No item-status gate (any PENDING/COOKING item is still billed; CANCELLED already excluded from
 * the total). Autocommit statements (no multi-statement transaction). Accepted trade-off: a crash
 * between steps 1 and 2 leaves a PAID order with no payment row (lost audit, never a double charge).
 */
export async function checkoutOrder(
  database: Database,
  restaurantId: string,
  orderId: string,
  input: { method: PaymentMethod },
  cashierId: string,
): Promise<CheckoutResult> {
  const claimed = await database
    .update(orders)
    .set({ status: 'PAID', closedAt: new Date() })
    .where(
      and(eq(orders.id, orderId), eq(orders.restaurantId, restaurantId), eq(orders.status, 'OPEN')),
    )
    .returning({ tableId: orders.tableId, total: orders.total })
  if (!claimed[0]) await throwOrderGateFailure(database, restaurantId, orderId)
  const { tableId, total } = claimed[0]!

  const [payment] = await database
    .insert(payments)
    .values({ orderId, method: input.method, amount: total, cashierId })
    .returning({
      id: payments.id,
      method: payments.method,
      amount: payments.amount,
      paidAt: payments.paidAt,
    })

  await database.update(tables).set({ status: 'EMPTY' }).where(eq(tables.id, tableId))

  return {
    payment: {
      id: payment!.id,
      method: payment!.method,
      amount: payment!.amount,
      paidAt: payment!.paidAt.toISOString(),
    },
    order: await loadOrder(database, orderId),
  }
}
```

- [ ] **Step 2: Add the payment route**

In `src/presentation/http/routes/cashier.ts`: add the import

```ts
import { checkoutOrder } from '../../../application/cashier/checkout-order'
```

and chain a `.post` after the discount route:

```ts
  .post(
    '/orders/:id/payment',
    async ({ auth, params, body }) => {
      const result = await checkoutOrder(db, auth.restaurantId, params.id, body, auth.userId)
      return { data: result }
    },
    {
      params: idParams,
      body: t.Object({
        method: t.Union([t.Literal('CASH'), t.Literal('TRANSFER'), t.Literal('CARD')]),
      }),
      detail: { tags: ['Cashier'], summary: 'Finalize payment and close the table session' },
    },
  )
```

- [ ] **Step 3: Write the failing integration test (checkout happy + double-checkout + cross-tenant)**

Append to `test/cashier/cashier-routes.integration.test.ts`:

```ts
describe('cashier checkout', () => {
  it(
    'finalizes payment: order PAID, payment.amount = total, table freed to EMPTY',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(cashierAEmail)
      const seeded = await seedOpenOrder({ subtotal: 80000, unitPrice: 80000, quantity: 1 })
      const res = await req(`/cashier/orders/${seeded.orderId}/payment`, {
        method: 'POST',
        token,
        body: { method: 'CASH' },
      })
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as {
        data: { payment: { amount: number }; order: { status: string } }
      }
      expect(data.payment.amount).toBe(80000)
      expect(data.order.status).toBe('PAID')

      const [tableRow] = await db.select({ status: tables.status }).from(tables).where(eq(tables.id, seeded.tableId))
      expect(tableRow!.status).toBe('EMPTY')

      const paid = await db.select().from(payments).where(eq(payments.orderId, seeded.orderId))
      expect(paid.length).toBe(1)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'a second checkout is refused (409 ORDER_NOT_OPEN) and creates no second payment',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(cashierAEmail)
      const seeded = await seedOpenOrder({ subtotal: 40000, unitPrice: 40000, quantity: 1 })
      const first = await req(`/cashier/orders/${seeded.orderId}/payment`, { method: 'POST', token, body: { method: 'CARD' } })
      expect(first.status).toBe(200)
      const second = await req(`/cashier/orders/${seeded.orderId}/payment`, { method: 'POST', token, body: { method: 'CARD' } })
      expect(second.status).toBe(409)
      expect(await errorCode(second)).toBe('ORDER_NOT_OPEN')

      const paid = await db.select().from(payments).where(eq(payments.orderId, seeded.orderId))
      expect(paid.length).toBe(1)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'cannot check out another restaurant order — 404 ORDER_NOT_FOUND',
    async () => {
      if (!schemaAvailable) return
      const seeded = await seedOpenOrder({ subtotal: 40000, unitPrice: 40000, quantity: 1 })
      const bToken = await tokenFor(cashierBEmail)
      const res = await req(`/cashier/orders/${seeded.orderId}/payment`, { method: 'POST', token: bToken, body: { method: 'CASH' } })
      expect(res.status).toBe(404)
      expect(await errorCode(res)).toBe('ORDER_NOT_FOUND')
    },
    DB_TIMEOUT_MS,
  )
})
```

> NOTE: `afterAll` deletes `orders` for the tenant, but `payments.order_id` is a non-cascading FK → `orders.id`. Update `afterAll` to delete `payments` for the tenant's orders BEFORE deleting `orders` (e.g. `await db.delete(payments).where(inArray(payments.orderId, db.select({ id: orders.id }).from(orders).where(eq(orders.restaurantId, rid))))`, or collect order ids first). Verify cleanup runs clean against the live DB.

- [ ] **Step 4: Run the appended tests — verify they FAIL, then PASS**

Run before Steps 1–2: `bun test test/cashier/cashier-routes.integration.test.ts` → checkout block FAILs (route 404).
After implementing: PASS.

- [ ] **Step 5: Typecheck, lint, full suite**

Run: `bun run typecheck && bun run lint && bun test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/application/cashier/checkout-order.ts src/presentation/http/routes/cashier.ts \
  test/cashier/cashier-routes.integration.test.ts
git commit -m "feat(us-018): finalize payment + close session (atomic OPEN→PAID gate)"
```

---

## Final steps (after Task 3)

- [ ] **Story packet** — create `docs/stories/epics/E08-cashier-payment/US-018-cashier-payment/` from `docs/templates/high-risk-story/` (overview/validation/design/execplan). Record the money-safety invariants (no double-charge; server-authoritative amount; accepted crash-window between gate and payment insert).
- [ ] **Backlog** — in `docs/stories/backlog.md`, move E08 from "Candidate (unsliced)" to a sliced/done row (US-018 done); note surcharge + bill-requested badge remain deferred.
- [ ] **Whole-branch review** — run the project's review gate (e.g. `/code-review high`) against the merge base; address Critical/Important before merge.
- [ ] **Finish the branch** — use `superpowers:finishing-a-development-branch` (PR with a normal merge commit per repo convention, never squash).

---

## Self-Review

**Spec coverage:**
- US-5.1 open tables list → Task 1 `listOpenTables` + `GET /cashier/tables`. ✓ (badge deferred — noted in spec Non-Goals.)
- US-5.2 bill detail → Task 1 `getBill` + `GET /cashier/orders/:id`. ✓
- US-5.3 discount (% / fixed, reason) → Task 2 `resolveDiscountAmount` + `applyDiscount` + `PATCH …/discount`. ✓
- US-5.4 finalize payment + close session → Task 3 `checkoutOrder` + `POST …/payment`. ✓
- Errors `ORDER_NOT_FOUND`/`ORDER_NOT_OPEN`/`INVALID_DISCOUNT` → added in Tasks 1/2. ✓
- Tenancy, server-authoritative amount, no double-charge gate, no migration → covered. ✓

**Placeholder scan:** No TBD/TODO. Two implementer NOTEs flag real FK-cleanup details (order_items→menu_items, payments→orders) the seed/teardown must satisfy — these are concrete instructions, not deferrals.

**Type consistency:** `OpenTableView`, `DiscountInput`, `resolveDiscountAmount`, `throwOrderGateFailure`, `applyDiscount`, `checkoutOrder`, `CheckoutResult` names/signatures are consistent across tasks; `loadOrder`/`OrderView` reused from `src/application/orders/get-order.ts` (verified to exist). `auth.userId`/`auth.restaurantId` match the auth-guard claims.
