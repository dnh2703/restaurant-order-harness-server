# US-017 Admin Tables CRUD + QR token — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an `ADMIN` full CRUD over their restaurant's tables plus per-table QR token mint/regenerate, resolvable by the existing customer QR flow.

**Architecture:** Application use-cases in `src/application/tables/` (one file per command/query, mirroring `src/application/menu-items/`), an Elysia route at `src/presentation/http/routes/tables.ts` mounted under `/api`, tenant-scoped **directly** by `tables.restaurantId` (no joins). Tokens minted with `crypto.randomUUID()`. Delete is refused while a table has an `OPEN` order.

**Tech Stack:** Bun, Elysia, Drizzle ORM (Postgres/Neon), TypeBox (`t.*`) route schemas, `bun:test`.

## Global Constraints

- Every route guarded by `authGuard` + `.guard({ auth: ['ADMIN'] })`; tenant always from `auth.restaurantId`, never body/params.
- Response envelope: success `{ data: ... }`, error `{ error: { code, message } }` (via `AppError` + `errorHandler`). Clients branch on `code`.
- Money/`capacity` are integers. `qrToken` is server-generated only — never accepted from the client.
- DB-backed test suites self-skip via `probeMigratedDb()` so a plain `bun test` stays green offline; per-test timeout `DB_TIMEOUT_MS`, `beforeAll` budget `WARMUP_TIMEOUT_MS`.
- Each task ends green on `bun test`, `bun run typecheck`, `bun run lint`.
- Conventional commits scoped `(us-017)`.

---

## File Structure

- `src/shared/errors/error-catalog.ts` — **modify**: add `TABLE_NOT_FOUND` (404), `TABLE_IN_USE` (409).
- `src/application/tables/table-view.ts` — **create**: `TableView` + `toTableView(row)`.
- `src/application/tables/list-tables.ts` — **create**: `listTablesUseCase`.
- `src/application/tables/create-table.ts` — **create**: `createTableUseCase` (mints token).
- `src/application/tables/update-table.ts` — **create**: `updateTableUseCase` (partial patch).
- `src/application/tables/regenerate-qr.ts` — **create**: `regenerateQrUseCase` (new token).
- `src/application/tables/delete-table.ts` — **create**: `deleteTableUseCase` (in-use guard).
- `src/presentation/http/routes/tables.ts` — **create**: `tablesRoutes`.
- `src/presentation/http/app.ts` — **modify**: mount `tablesRoutes`.
- `test/tables/table-view.test.ts` — **create**: unit.
- `test/tables/table-use-cases.test.ts` — **create**: DB-backed use-case behavior (self-skipping).
- `test/tables/tables-routes.integration.test.ts` — **create**: two-tenant HTTP (self-skipping).
- `docs/stories/epics/E09-admin-crud/US-017-tables-crud/overview.md` + `validation.md` — **create**.
- `docs/stories/backlog.md` — **modify**: mark US-017 done.

---

## Task 1: Error codes + TableView mapper

**Files:**
- Modify: `src/shared/errors/error-catalog.ts`
- Create: `src/application/tables/table-view.ts`
- Test: `test/tables/table-view.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Error codes `TABLE_NOT_FOUND` (404), `TABLE_IN_USE` (409) usable via `new AppError('TABLE_NOT_FOUND')`.
  - `interface TableView { id: string; name: string; capacity: number | null; qrToken: string; status: 'EMPTY' | 'OCCUPIED' }`.
  - `toTableView(row: { id: string; name: string; capacity: number | null; qrToken: string; status: 'EMPTY' | 'OCCUPIED' }): TableView`.

- [ ] **Step 1: Add the error codes**

In `src/shared/errors/error-catalog.ts`, add a new block before `// Tables & QR sessions (US-005)` (or right after the US-016 block):

```ts
  // Table administration (US-017)
  TABLE_NOT_FOUND: { status: 404, message: 'Table not found' },
  TABLE_IN_USE: {
    status: 409,
    message: 'Cannot delete a table that has an open order',
  },
```

- [ ] **Step 2: Write the failing unit test**

Create `test/tables/table-view.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'

import { toTableView } from '../../src/application/tables/table-view'

describe('toTableView', () => {
  it('maps a row to the admin-facing view', () => {
    const view = toTableView({
      id: 'table-1',
      name: 'Bàn 5',
      capacity: 4,
      qrToken: 'tok-abc',
      status: 'EMPTY',
    })
    expect(view).toEqual({
      id: 'table-1',
      name: 'Bàn 5',
      capacity: 4,
      qrToken: 'tok-abc',
      status: 'EMPTY',
    })
  })

  it('preserves a null capacity and an OCCUPIED status', () => {
    const view = toTableView({
      id: 'table-2',
      name: 'Bàn 6',
      capacity: null,
      qrToken: 'tok-def',
      status: 'OCCUPIED',
    })
    expect(view.capacity).toBeNull()
    expect(view.status).toBe('OCCUPIED')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test test/tables/table-view.test.ts`
Expected: FAIL — cannot resolve `../../src/application/tables/table-view`.

- [ ] **Step 4: Create the view mapper**

Create `src/application/tables/table-view.ts`:

```ts
/**
 * Admin-facing shape of a table (US-017). `qrToken` is exposed so the admin can build/print the QR;
 * `status` is read-only here (system-managed by the session lifecycle, US-005). `capacity` is a
 * nullable integer.
 */
export interface TableView {
  id: string
  name: string
  capacity: number | null
  qrToken: string
  status: 'EMPTY' | 'OCCUPIED'
}

export function toTableView(row: {
  id: string
  name: string
  capacity: number | null
  qrToken: string
  status: 'EMPTY' | 'OCCUPIED'
}): TableView {
  return {
    id: row.id,
    name: row.name,
    capacity: row.capacity,
    qrToken: row.qrToken,
    status: row.status,
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test test/tables/table-view.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/shared/errors/error-catalog.ts src/application/tables/table-view.ts test/tables/table-view.test.ts
git commit -m "feat(us-017): table view mapper + TABLE_NOT_FOUND/TABLE_IN_USE error codes"
```

---

## Task 2: list-tables + create-table use-cases

**Files:**
- Create: `src/application/tables/list-tables.ts`
- Create: `src/application/tables/create-table.ts`
- Test: `test/tables/table-use-cases.test.ts` (created here; extended in Tasks 3–4)

**Interfaces:**
- Consumes: `TableView`, `toTableView` (Task 1).
- Produces:
  - `listTablesUseCase(database: Database, restaurantId: string): Promise<TableView[]>` — tables of the restaurant ordered by `name`.
  - `interface CreateTableInput { name: string; capacity?: number | null }`.
  - `createTableUseCase(database: Database, restaurantId: string, input: CreateTableInput): Promise<TableView>` — mints `qrToken` via `crypto.randomUUID()`, `status` defaults `EMPTY`.

- [ ] **Step 1: Write the list use-case**

Create `src/application/tables/list-tables.ts`:

```ts
import { asc, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { tables } from '../../infrastructure/database/schema'
import { type TableView, toTableView } from './table-view'

/**
 * List a restaurant's tables (US-017), ordered by `name`. `tables` carries its own `restaurantId`,
 * so tenancy is a direct filter — no joins (unlike US-015/US-016).
 */
export async function listTablesUseCase(
  database: Database,
  restaurantId: string,
): Promise<TableView[]> {
  const rows = await database
    .select()
    .from(tables)
    .where(eq(tables.restaurantId, restaurantId))
    .orderBy(asc(tables.name))
  return rows.map(toTableView)
}
```

- [ ] **Step 2: Write the create use-case**

Create `src/application/tables/create-table.ts`:

```ts
import { randomUUID } from 'node:crypto'

import type { Database } from '../../infrastructure/database/client'
import { tables } from '../../infrastructure/database/schema'
import { type TableView, toTableView } from './table-view'

export interface CreateTableInput {
  name: string
  capacity?: number | null
}

/**
 * Create a table in the admin's restaurant (US-017). The server mints an unguessable `qrToken`
 * (`crypto.randomUUID()`); `status` defaults `EMPTY` (schema default) and is never client-set.
 * `capacity` defaults null.
 */
export async function createTableUseCase(
  database: Database,
  restaurantId: string,
  input: CreateTableInput,
): Promise<TableView> {
  const [created] = await database
    .insert(tables)
    .values({
      restaurantId,
      name: input.name,
      capacity: input.capacity ?? null,
      qrToken: randomUUID(),
    })
    .returning()
  return toTableView(created!)
}
```

- [ ] **Step 3: Write the failing DB-backed use-case test**

Create `test/tables/table-use-cases.test.ts`:

```ts
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { createTableUseCase } from '../../src/application/tables/create-table'
import { listTablesUseCase } from '../../src/application/tables/list-tables'
import { db } from '../../src/infrastructure/database/client'
import { orders, restaurants, tables } from '../../src/infrastructure/database/schema'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'

let schemaAvailable = false
let restaurantId = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const [r] = await db
    .insert(restaurants)
    .values({ name: 'US-017 use-cases' })
    .returning({ id: restaurants.id })
  restaurantId = r!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable || !restaurantId) return
  await db.delete(orders).where(eq(orders.restaurantId, restaurantId)) // cascades order_items
  await db.delete(tables).where(eq(tables.restaurantId, restaurantId))
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId))
}, DB_TIMEOUT_MS)

describe('tables use-cases', () => {
  it(
    'create mints a non-empty qrToken, defaults status EMPTY, and lists ordered by name',
    async () => {
      if (!schemaAvailable) return
      const b = await createTableUseCase(db, restaurantId, { name: 'Bàn B', capacity: 2 })
      const a = await createTableUseCase(db, restaurantId, { name: 'Bàn A' })
      expect(a.qrToken.length).toBeGreaterThan(0)
      expect(a.status).toBe('EMPTY')
      expect(a.capacity).toBeNull()
      expect(b.capacity).toBe(2)

      const listed = await listTablesUseCase(db, restaurantId)
      const names = listed.map((t) => t.name)
      expect(names.indexOf('Bàn A')).toBeLessThan(names.indexOf('Bàn B'))
    },
    DB_TIMEOUT_MS,
  )
})
```

- [ ] **Step 4: Run the suite**

Run: `bun test test/tables/table-use-cases.test.ts`
Expected: PASS if a migrated DB is reachable; otherwise the suite self-skips (still green). Confirm it does not FAIL.

- [ ] **Step 5: Typecheck + lint + full test**

Run: `bun run typecheck && bun run lint && bun test`
Expected: clean; all green.

- [ ] **Step 6: Commit**

```bash
git add src/application/tables/list-tables.ts src/application/tables/create-table.ts test/tables/table-use-cases.test.ts
git commit -m "feat(us-017): list + create table use-cases"
```

---

## Task 3: update-table + regenerate-qr use-cases

**Files:**
- Create: `src/application/tables/update-table.ts`
- Create: `src/application/tables/regenerate-qr.ts`
- Test: `test/tables/table-use-cases.test.ts` (extend)

**Interfaces:**
- Consumes: `TableView`, `toTableView` (Task 1); `AppError` from `../../shared/errors`.
- Produces:
  - `interface UpdateTableInput { name?: string; capacity?: number | null }`.
  - `updateTableUseCase(database, restaurantId, id, input): Promise<TableView>` — partial patch; missing/cross-tenant → `AppError('TABLE_NOT_FOUND')`.
  - `regenerateQrUseCase(database, restaurantId, id): Promise<TableView>` — sets `qrToken` to a fresh `randomUUID()`; missing/cross-tenant → `AppError('TABLE_NOT_FOUND')`.

- [ ] **Step 1: Write the update use-case**

Create `src/application/tables/update-table.ts`:

```ts
import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { tables } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { type TableView, toTableView } from './table-view'

export interface UpdateTableInput {
  name?: string
  capacity?: number | null
}

/**
 * Update a table (US-017). Tenant-scoped directly by `restaurantId`, so another restaurant's table
 * matches no rows → `TABLE_NOT_FOUND` (404). `status` and `qrToken` are not patchable here
 * (status is system-managed; the token changes only via regenerate). Only sent fields are patched.
 */
export async function updateTableUseCase(
  database: Database,
  restaurantId: string,
  id: string,
  input: UpdateTableInput,
): Promise<TableView> {
  const scope = and(eq(tables.id, id), eq(tables.restaurantId, restaurantId))

  const patch: Partial<{ name: string; capacity: number | null }> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.capacity !== undefined) patch.capacity = input.capacity

  if (Object.keys(patch).length === 0) {
    const [current] = await database.select().from(tables).where(scope).limit(1)
    if (!current) throw new AppError('TABLE_NOT_FOUND')
    return toTableView(current)
  }

  const [updated] = await database.update(tables).set(patch).where(scope).returning()
  if (!updated) throw new AppError('TABLE_NOT_FOUND')
  return toTableView(updated)
}
```

- [ ] **Step 2: Write the regenerate-qr use-case**

Create `src/application/tables/regenerate-qr.ts`:

```ts
import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { tables } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { type TableView, toTableView } from './table-view'

/**
 * Mint a fresh `qrToken` for a table (US-017 / US-1.3). The old QR stops resolving immediately
 * (`GET /api/qr/:qrToken` is an exact-match lookup). Tenant-scoped directly by `restaurantId`;
 * missing/cross-tenant → `TABLE_NOT_FOUND` (404). A `randomUUID()` collision on the `unique`
 * `qr_token` is effectively unreachable, so no dedicated conflict code is introduced.
 */
export async function regenerateQrUseCase(
  database: Database,
  restaurantId: string,
  id: string,
): Promise<TableView> {
  const scope = and(eq(tables.id, id), eq(tables.restaurantId, restaurantId))
  const [updated] = await database
    .update(tables)
    .set({ qrToken: randomUUID() })
    .where(scope)
    .returning()
  if (!updated) throw new AppError('TABLE_NOT_FOUND')
  return toTableView(updated)
}
```

- [ ] **Step 3: Extend the DB-backed use-case test**

In `test/tables/table-use-cases.test.ts`, add imports at the top (alongside the existing ones):

```ts
import { regenerateQrUseCase } from '../../src/application/tables/regenerate-qr'
import { updateTableUseCase } from '../../src/application/tables/update-table'
import { AppError } from '../../src/shared/errors'
```

Then add inside `describe('tables use-cases', ...)`:

```ts
  it(
    'update patches only sent fields and 404s a cross-tenant id',
    async () => {
      if (!schemaAvailable) return
      const created = await createTableUseCase(db, restaurantId, { name: 'Patch me', capacity: 2 })
      const patched = await updateTableUseCase(db, restaurantId, created.id, { capacity: 8 })
      expect(patched.name).toBe('Patch me')
      expect(patched.capacity).toBe(8)

      await expect(updateTableUseCase(db, restaurantId, randomUUID(), { name: 'x' })).rejects.toEqual(
        new AppError('TABLE_NOT_FOUND'),
      )
    },
    DB_TIMEOUT_MS,
  )

  it(
    'regenerate replaces the qrToken with a different value',
    async () => {
      if (!schemaAvailable) return
      const created = await createTableUseCase(db, restaurantId, { name: 'Re-token' })
      const regenerated = await regenerateQrUseCase(db, restaurantId, created.id)
      expect(regenerated.qrToken).not.toBe(created.qrToken)
      expect(regenerated.qrToken.length).toBeGreaterThan(0)

      await expect(regenerateQrUseCase(db, restaurantId, randomUUID())).rejects.toEqual(
        new AppError('TABLE_NOT_FOUND'),
      )
    },
    DB_TIMEOUT_MS,
  )
```

- [ ] **Step 4: Run the suite**

Run: `bun test test/tables/table-use-cases.test.ts`
Expected: PASS (or self-skip). Not FAIL.

- [ ] **Step 5: Typecheck + lint + full test**

Run: `bun run typecheck && bun run lint && bun test`
Expected: clean; all green.

- [ ] **Step 6: Commit**

```bash
git add src/application/tables/update-table.ts src/application/tables/regenerate-qr.ts test/tables/table-use-cases.test.ts
git commit -m "feat(us-017): update + regenerate-qr table use-cases"
```

---

## Task 4: delete-table use-case (in-use guard)

**Files:**
- Create: `src/application/tables/delete-table.ts`
- Test: `test/tables/table-use-cases.test.ts` (extend)

**Interfaces:**
- Consumes: `AppError`, `pgErrorCode` from `../../shared/errors`; `tables`, `orders` schema.
- Produces: `deleteTableUseCase(database, restaurantId, id): Promise<void>` — `TABLE_NOT_FOUND` (404) if missing/cross-tenant; `TABLE_IN_USE` (409) if an `OPEN` order references the table.

- [ ] **Step 1: Write the delete use-case**

Create `src/application/tables/delete-table.ts`:

```ts
import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orders, tables } from '../../infrastructure/database/schema'
import { AppError, pgErrorCode } from '../../shared/errors'

/**
 * Delete a table (US-017). Tenant-scoped existence check first → `TABLE_NOT_FOUND` (404) for a
 * missing/cross-tenant id. A table with an `OPEN` order is refused with `TABLE_IN_USE` (409): we
 * check first for a clean answer, and map the FK violation (SQLSTATE 23503 — `orders.table_id` is a
 * non-cascading FK) to the same code so a concurrent order insert between the check and the delete
 * stays safe under Neon's transaction pooling.
 */
export async function deleteTableUseCase(
  database: Database,
  restaurantId: string,
  id: string,
): Promise<void> {
  const scope = and(eq(tables.id, id), eq(tables.restaurantId, restaurantId))

  const [current] = await database.select({ id: tables.id }).from(tables).where(scope).limit(1)
  if (!current) throw new AppError('TABLE_NOT_FOUND')

  const [open] = await database
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.tableId, id), eq(orders.status, 'OPEN')))
    .limit(1)
  if (open) throw new AppError('TABLE_IN_USE')

  try {
    await database.delete(tables).where(scope)
  } catch (error) {
    if (pgErrorCode(error) === '23503') throw new AppError('TABLE_IN_USE')
    throw error
  }
}
```

- [ ] **Step 2: Extend the DB-backed use-case test**

In `test/tables/table-use-cases.test.ts`, add the import:

```ts
import { deleteTableUseCase } from '../../src/application/tables/delete-table'
```

Add `orders` is already imported. Add inside `describe('tables use-cases', ...)`:

```ts
  it(
    'delete removes an empty table but refuses one with an OPEN order',
    async () => {
      if (!schemaAvailable) return
      const empty = await createTableUseCase(db, restaurantId, { name: 'Removable' })
      await deleteTableUseCase(db, restaurantId, empty.id)
      const after = await listTablesUseCase(db, restaurantId)
      expect(after.some((t) => t.id === empty.id)).toBe(false)

      const busy = await createTableUseCase(db, restaurantId, { name: 'Busy' })
      await db.insert(orders).values({ restaurantId, tableId: busy.id })
      await expect(deleteTableUseCase(db, restaurantId, busy.id)).rejects.toEqual(
        new AppError('TABLE_IN_USE'),
      )
    },
    DB_TIMEOUT_MS,
  )
```

- [ ] **Step 3: Run the suite**

Run: `bun test test/tables/table-use-cases.test.ts`
Expected: PASS (or self-skip). Not FAIL.

- [ ] **Step 4: Typecheck + lint + full test**

Run: `bun run typecheck && bun run lint && bun test`
Expected: clean; all green.

- [ ] **Step 5: Commit**

```bash
git add src/application/tables/delete-table.ts test/tables/table-use-cases.test.ts
git commit -m "feat(us-017): delete table use-case (in-use guard)"
```

---

## Task 5: tables route + mount + two-tenant HTTP integration

**Files:**
- Create: `src/presentation/http/routes/tables.ts`
- Modify: `src/presentation/http/app.ts`
- Test: `test/tables/tables-routes.integration.test.ts`

**Interfaces:**
- Consumes: all five use-cases (Tasks 2–4); `authGuard` from `../plugins/auth-guard`; `db` from `../../../infrastructure/database/client`.
- Produces: `export const tablesRoutes` (Elysia, `prefix: '/tables'`), mounted in `app.ts`.

- [ ] **Step 1: Write the route**

Create `src/presentation/http/routes/tables.ts`:

```ts
import { Elysia, t } from 'elysia'

import { createTableUseCase } from '../../../application/tables/create-table'
import { deleteTableUseCase } from '../../../application/tables/delete-table'
import { listTablesUseCase } from '../../../application/tables/list-tables'
import { regenerateQrUseCase } from '../../../application/tables/regenerate-qr'
import { updateTableUseCase } from '../../../application/tables/update-table'
import { db } from '../../../infrastructure/database/client'
import { authGuard } from '../plugins/auth-guard'

const tableView = t.Object({
  id: t.String({ format: 'uuid' }),
  name: t.String(),
  capacity: t.Union([t.Integer(), t.Null()]),
  qrToken: t.String(),
  status: t.Union([t.Literal('EMPTY'), t.Literal('OCCUPIED')]),
})

const createBody = t.Object({
  name: t.String({ minLength: 1 }),
  capacity: t.Optional(t.Union([t.Integer({ minimum: 1 }), t.Null()])),
})

const updateBody = t.Object(
  {
    name: t.Optional(t.String({ minLength: 1 })),
    capacity: t.Optional(t.Union([t.Integer({ minimum: 1 }), t.Null()])),
  },
  { minProperties: 1 },
)

const idParams = t.Object({ id: t.String({ format: 'uuid' }) })

/**
 * Admin table administration (US-017). Every route is guarded by `ADMIN` and tenant-scoped directly
 * by `tables.restaurantId` (the restaurant always comes from `auth.restaurantId`). `qrToken` is
 * server-minted; `status` is read-only. `POST /:id/regenerate-qr` mints a fresh token, invalidating
 * the old QR.
 *
 * See docs/product/ (US-6.4, US-1.3).
 */
export const tablesRoutes = new Elysia({ prefix: '/tables' })
  .use(authGuard)
  .guard({ auth: ['ADMIN'] })
  .get(
    '/',
    async ({ auth }) => {
      const tables = await listTablesUseCase(db, auth.restaurantId)
      return { data: { tables } }
    },
    {
      detail: { tags: ['Tables'], summary: 'List tables' },
      response: { 200: t.Object({ data: t.Object({ tables: t.Array(tableView) }) }) },
    },
  )
  .post(
    '/',
    async ({ auth, body, set }) => {
      const table = await createTableUseCase(db, auth.restaurantId, body)
      set.status = 201
      return { data: { table } }
    },
    {
      body: createBody,
      detail: { tags: ['Tables'], summary: 'Create a table (mints a QR token)' },
      response: { 201: t.Object({ data: t.Object({ table: tableView }) }) },
    },
  )
  .patch(
    '/:id',
    async ({ auth, params, body }) => {
      const table = await updateTableUseCase(db, auth.restaurantId, params.id, body)
      return { data: { table } }
    },
    {
      params: idParams,
      body: updateBody,
      detail: { tags: ['Tables'], summary: 'Update a table' },
      response: { 200: t.Object({ data: t.Object({ table: tableView }) }) },
    },
  )
  .post(
    '/:id/regenerate-qr',
    async ({ auth, params }) => {
      const table = await regenerateQrUseCase(db, auth.restaurantId, params.id)
      return { data: { table } }
    },
    {
      params: idParams,
      detail: { tags: ['Tables'], summary: 'Regenerate the QR token (invalidates the old QR)' },
      response: { 200: t.Object({ data: t.Object({ table: tableView }) }) },
    },
  )
  .delete(
    '/:id',
    async ({ auth, params, set }) => {
      await deleteTableUseCase(db, auth.restaurantId, params.id)
      set.status = 204
    },
    {
      params: idParams,
      detail: { tags: ['Tables'], summary: 'Delete a table (blocked if it has an open order)' },
      response: { 204: t.Void() },
    },
  )
```

- [ ] **Step 2: Mount the route in app.ts**

In `src/presentation/http/app.ts`, add the import (alphabetical, after `staffRoutes` / before `streamRoutes`):

```ts
import { tablesRoutes } from './routes/tables'
```

And add `.use(tablesRoutes)` to the chain (after `.use(streamRoutes)` is fine; place it after `.use(qrRoutes)`):

```ts
  .use(qrRoutes)
  .use(tablesRoutes)
  .use(streamRoutes)
```

- [ ] **Step 3: Write the failing two-tenant integration test**

Create `test/tables/tables-routes.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { hashPassword } from '../../src/infrastructure/auth/password'
import { db } from '../../src/infrastructure/database/client'
import { orders, restaurants, tables, users } from '../../src/infrastructure/database/schema'
import { app } from '../../src/presentation/http/app'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'
import { errorCode } from '../support/http'

let schemaAvailable = false
const password = 'admin-pw-us017'
const adminAEmail = `admin-a-${randomUUID()}@us017.test`
const adminBEmail = `admin-b-${randomUUID()}@us017.test`
const cashierAEmail = `cashier-a-${randomUUID()}@us017.test`
let restaurantAId = ''
let restaurantBId = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const passwordHash = await hashPassword(password)
  const [a] = await db
    .insert(restaurants)
    .values({ name: 'US-017 A' })
    .returning({ id: restaurants.id })
  restaurantAId = a!.id
  const [b] = await db
    .insert(restaurants)
    .values({ name: 'US-017 B' })
    .returning({ id: restaurants.id })
  restaurantBId = b!.id
  await db.insert(users).values([
    { restaurantId: restaurantAId, email: adminAEmail, passwordHash, name: 'Admin A', role: 'ADMIN' },
    {
      restaurantId: restaurantAId,
      email: cashierAEmail,
      passwordHash,
      name: 'Cashier A',
      role: 'CASHIER',
    },
    { restaurantId: restaurantBId, email: adminBEmail, passwordHash, name: 'Admin B', role: 'ADMIN' },
  ])
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable) return
  for (const rid of [restaurantAId, restaurantBId].filter(Boolean)) {
    await db.delete(orders).where(eq(orders.restaurantId, rid)) // cascades order_items
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

function req(
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<Response> {
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

describe('tables CRUD', () => {
  it(
    'rejects a non-admin with 403 and a missing token with 401',
    async () => {
      if (!schemaAvailable) return
      const cashier = await tokenFor(cashierAEmail)
      expect((await req('/tables', { token: cashier })).status).toBe(403)
      expect((await req('/tables')).status).toBe(401)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'creates (minting a token), lists, updates, and deletes scoped to the admin restaurant',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)

      const created = await req('/tables', {
        method: 'POST',
        token,
        body: { name: 'Bàn 1', capacity: 4 },
      })
      expect(created.status).toBe(201)
      const { data: c } = (await created.json()) as {
        data: { table: { id: string; qrToken: string; status: string; capacity: number | null } }
      }
      expect(c.table.status).toBe('EMPTY')
      expect(c.table.qrToken.length).toBeGreaterThan(0)
      expect(c.table.capacity).toBe(4)
      const id = c.table.id

      const listed = await req('/tables', { token })
      expect(listed.status).toBe(200)
      const { data: l } = (await listed.json()) as { data: { tables: Array<{ id: string }> } }
      expect(l.tables.some((x) => x.id === id)).toBe(true)

      const patched = await req(`/tables/${id}`, {
        method: 'PATCH',
        token,
        body: { name: 'Bàn 1A', capacity: 6 },
      })
      expect(patched.status).toBe(200)
      const { data: p } = (await patched.json()) as {
        data: { table: { name: string; capacity: number } }
      }
      expect(p.table).toMatchObject({ name: 'Bàn 1A', capacity: 6 })

      const del = await req(`/tables/${id}`, { method: 'DELETE', token })
      expect(del.status).toBe(204)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'ignores a client-supplied status and qrToken on create',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const res = await req('/tables', {
        method: 'POST',
        token,
        body: { name: 'Sneaky', status: 'OCCUPIED', qrToken: 'client-chosen' },
      })
      // Extra fields are stripped by the TypeBox body schema; create still succeeds with defaults.
      expect(res.status).toBe(201)
      const { data } = (await res.json()) as {
        data: { table: { status: string; qrToken: string } }
      }
      expect(data.table.status).toBe('EMPTY')
      expect(data.table.qrToken).not.toBe('client-chosen')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'regenerate-qr replaces the token; the old token no longer resolves and the new one does',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const created = await req('/tables', { method: 'POST', token, body: { name: 'QR table' } })
      const { data: c } = (await created.json()) as { data: { table: { id: string; qrToken: string } } }
      const oldToken = c.table.qrToken

      const regen = await req(`/tables/${c.table.id}/regenerate-qr`, { method: 'POST', token })
      expect(regen.status).toBe(200)
      const { data: r } = (await regen.json()) as { data: { table: { qrToken: string } } }
      const newToken = r.table.qrToken
      expect(newToken).not.toBe(oldToken)

      // The customer QR-resolve route (US-005) is public.
      expect((await req(`/qr/${oldToken}`)).status).toBe(404)
      expect((await req(`/qr/${newToken}`)).status).toBe(200)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'cannot touch another restaurant table — 404 TABLE_NOT_FOUND',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const [bTable] = await db
        .insert(tables)
        .values({ restaurantId: restaurantBId, name: 'B table', qrToken: `tok-${randomUUID()}` })
        .returning({ id: tables.id })
      const res = await req(`/tables/${bTable!.id}`, {
        method: 'PATCH',
        token,
        body: { name: 'Hijack' },
      })
      expect(res.status).toBe(404)
      expect(await errorCode(res)).toBe('TABLE_NOT_FOUND')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'refuses to delete a table that has an OPEN order — 409 TABLE_IN_USE',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const [table] = await db
        .insert(tables)
        .values({ restaurantId: restaurantAId, name: 'Busy', qrToken: `tok-${randomUUID()}` })
        .returning({ id: tables.id })
      await db.insert(orders).values({ restaurantId: restaurantAId, tableId: table!.id })
      const res = await req(`/tables/${table!.id}`, { method: 'DELETE', token })
      expect(res.status).toBe(409)
      expect(await errorCode(res)).toBe('TABLE_IN_USE')
    },
    DB_TIMEOUT_MS,
  )
})
```

- [ ] **Step 4: Run the integration suite**

Run: `bun test test/tables/tables-routes.integration.test.ts`
Expected: PASS if a migrated DB is reachable; otherwise self-skips. Not FAIL.

> Note: the `GET /api/qr/:qrToken` resolve route (US-005) creates/reuses the table's `OPEN` order on resolve. That order is cleaned up by the `afterAll` (`db.delete(orders)`), so no leak.

- [ ] **Step 5: Typecheck + lint + full test**

Run: `bun run typecheck && bun run lint && bun test`
Expected: clean; all green. The OpenAPI snapshot test (`test/openapi.test.ts`) may assert route counts — if it fails, update its snapshot per its own instructions and include that change in this commit.

- [ ] **Step 6: Commit**

```bash
git add src/presentation/http/routes/tables.ts src/presentation/http/app.ts test/tables/tables-routes.integration.test.ts
git commit -m "feat(us-017): tables CRUD + regenerate-qr route + mount"
```

---

## Task 6: Story packet + validation record + backlog

**Files:**
- Create: `docs/stories/epics/E09-admin-crud/US-017-tables-crud/overview.md`
- Create: `docs/stories/epics/E09-admin-crud/US-017-tables-crud/validation.md`
- Modify: `docs/stories/backlog.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Write the story overview**

Create `docs/stories/epics/E09-admin-crud/US-017-tables-crud/overview.md` summarizing US-017 in the same shape as `US-016-options-crud/overview.md`: Current Behavior, Target Behavior (the 5-row route table from the design spec), Affected Users (`ADMIN` gains table management; `Customer` resolves the QR token via US-005), Design Notes (direct `restaurantId` scope; `crypto.randomUUID()` tokens; in-use guard; status read-only; export deferred), Errors (`TABLE_NOT_FOUND`, `TABLE_IN_USE`), Validation table, Harness Delta (none), Non-Goals (PNG/PDF export, `number` column, admin-set status, bulk create). Source the content from `docs/superpowers/specs/2026-06-28-us-017-tables-crud-design.md`.

- [ ] **Step 2: Write the validation record**

Run the actual suite first to capture real numbers:

Run: `bun test 2>&1 | tail -5`

Create `docs/stories/epics/E09-admin-crud/US-017-tables-crud/validation.md` in the same shape as `US-016-options-crud/validation.md`:
- Proof Status line: `scripts/bin/harness-cli story update --id US-017 --unit 1 --integration 1 --e2e 0 --platform 0`
- Layer table: Unit (`test/tables/table-view.test.ts`), Integration (`test/tables/table-use-cases.test.ts` + `test/tables/tables-routes.integration.test.ts`, noting whether the live DB ran or self-skipped), E2E (deferred — token resolves via US-005), Platform (n/a).
- Evidence: paste the real `bun test` totals from the run above, plus `bun run typecheck` / `bun run lint` clean.

- [ ] **Step 3: Update the backlog**

In `docs/stories/backlog.md`, update the E09 row status from:

```
| E09 Admin CRUD | US-014 categories, US-015 menu-items, US-016 options, US-017 tables + QR | slicing (US-014, US-015, US-016 done; US-017 next) |
```

to:

```
| E09 Admin CRUD | US-014 categories, US-015 menu-items, US-016 options, US-017 tables + QR | done (US-014, US-015, US-016, US-017 done) |
```

- [ ] **Step 4: Run the harness-cli story update**

Run: `scripts/bin/harness-cli story update --id US-017 --unit 1 --integration 1 --e2e 0 --platform 0`
Expected: the durable matrix row records the proof. (If the CLI is unavailable in this environment, note it in the commit body and proceed.)

- [ ] **Step 5: Final full verification**

Run: `bun test && bun run typecheck && bun run lint`
Expected: all green; clean.

- [ ] **Step 6: Commit**

```bash
git add docs/stories/epics/E09-admin-crud/US-017-tables-crud/ docs/stories/backlog.md
git commit -m "docs(us-017): story packet + validation record + backlog status"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** list/create/update/delete/regenerate all have tasks (2–5); error codes (Task 1); route + mount (Task 5); tenancy + in-use guard + read-only status + token mint all covered; docs (Task 6). Deferred items (PNG/PDF, `number` column, admin status) are explicit non-goals — no task, by design.
- **Type consistency:** `TableView`/`toTableView` shape is identical across Tasks 1–5; `CreateTableInput`/`UpdateTableInput` match the route bodies; `qrToken`/`capacity`/`status` names consistent; `regenerateQrUseCase`/`deleteTableUseCase` signatures match their route call sites.
- **Placeholder scan:** no TBD/TODO; every code step shows full code; Task 6 docs reference the committed design spec as the content source rather than restating it (the overview is prose, not code).
