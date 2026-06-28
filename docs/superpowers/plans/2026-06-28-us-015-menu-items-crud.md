# US-015 Admin Menu-Items CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an `ADMIN` full runtime CRUD over menu items (create, list, edit/move/reorder, toggle availability, delete) scoped to their own restaurant, at `/api/menu-items`.

**Architecture:** Layered, mirroring US-014 categories. New use-cases under `src/application/menu-items/`, one Elysia route file mounted in `app.ts`. `menu_items` has **no `restaurantId`** — every operation scopes tenancy through `categoryId → categories.restaurantId` (the `exists(...)` subquery pattern already in `src/application/kitchen/set-item-availability.ts`). Delete is guarded against order history (FK restrict on `order_items`). Single autocommit statements + SQLSTATE backstops for Neon transaction pooling.

**Tech Stack:** Bun, ElysiaJS, Drizzle ORM on Neon/PostgreSQL, `bun:test`.

## Global Constraints

- Tenant scope ALWAYS comes from `auth.restaurantId` (token claims), never request body/params.
- Money is `integer` VND, never float; `price` must be an integer `>= 0`.
- Success envelope `{ data }`; error envelope `{ error: { code } }`; error codes are SCREAMING_SNAKE keys in `src/shared/errors/error-catalog.ts`, thrown via `new AppError('CODE')`.
- Neon runs PgBouncer transaction pooling: write single autocommit statements (no multi-statement transactions); map SQLSTATE codes (23503 FK violation) as race-safe backstops, not the primary guard.
- DB-backed test suites self-skip via `probeMigratedDb()` and use `DB_TIMEOUT_MS` / `WARMUP_TIMEOUT_MS` from `test/support/db.ts`, so a plain `bun test` stays green with no DB.
- Cross-tenant targets must return the same `404` as a missing id (never reveal another tenant's rows).
- All routes guarded by `authGuard` + `.guard({ auth: ['ADMIN'] })`.
- No migration: `menu_items` already exists with columns `id, categoryId, name, description, price, imageUrl, isAvailable, sortOrder`.

## File Structure

- `src/shared/errors/pg-error.ts` — **new** shared `pgErrorCode(error)` helper (consolidates 4 identical local copies; US-015 adds 3 more call sites).
- `src/shared/errors/index.ts` — re-export `pgErrorCode`.
- `src/shared/errors/error-catalog.ts` — add `MENU_ITEM_IN_USE` (409).
- `src/application/categories/delete-category.ts`, `src/application/orders/order-session.ts`, `src/application/sessions/resolve-table-session.ts`, `src/application/staff/create-staff.ts` — drop local `pgErrorCode`, import shared one.
- `src/application/menu-items/menu-item-view.ts` — view interface + mapper.
- `src/application/menu-items/list-menu-items.ts` — list (join categories, scope, optional categoryId, ordered).
- `src/application/menu-items/create-menu-item.ts` — create with category tenant pre-check.
- `src/application/menu-items/update-menu-item.ts` — partial patch + optional move.
- `src/application/menu-items/delete-menu-item.ts` — count guard then delete.
- `src/presentation/http/routes/menu-items.ts` — Elysia route.
- `src/presentation/http/app.ts` — mount `menuItemsRoutes`.
- `test/menu-items/menu-item-view.test.ts`, `test/menu-items/menu-item-use-cases.test.ts`, `test/menu-items/menu-items-routes.integration.test.ts`.
- `docs/stories/epics/E09-admin-crud/US-015-menu-items-crud/{overview,validation}.md`, `docs/stories/backlog.md`.

---

### Task 1: Shared `pgErrorCode` helper + `MENU_ITEM_IN_USE` error code

**Files:**
- Create: `src/shared/errors/pg-error.ts`
- Modify: `src/shared/errors/index.ts`
- Modify: `src/shared/errors/error-catalog.ts:42-47`
- Modify: `src/application/categories/delete-category.ts:1-11,44`
- Modify: `src/application/orders/order-session.ts:18-21`
- Modify: `src/application/sessions/resolve-table-session.ts:19-22`
- Modify: `src/application/staff/create-staff.ts:9-12`

**Interfaces:**
- Produces: `pgErrorCode(error: unknown): string | undefined` (exported from `src/shared/errors`); error code `MENU_ITEM_IN_USE` (409).

- [ ] **Step 1: Create the shared helper**

`src/shared/errors/pg-error.ts`:

```ts
/**
 * Extract the PostgreSQL SQLSTATE from a thrown error. Drizzle wraps driver errors, so the
 * pg error (with its `code`) may sit on the error itself or on its `cause`. Used to map raw
 * constraint violations (e.g. 23503 foreign-key) to domain AppErrors as race-safe backstops.
 */
export function pgErrorCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } }
  return e.code ?? e.cause?.code
}
```

- [ ] **Step 2: Re-export it from the errors barrel**

In `src/shared/errors/index.ts`, add:

```ts
export { pgErrorCode } from './pg-error'
```

- [ ] **Step 3: Add the new error code**

In `src/shared/errors/error-catalog.ts`, under the `// Menu category administration (US-014)` block, add a menu-item block right after `CATEGORY_NOT_EMPTY`:

```ts
  // Menu item administration (US-015)
  MENU_ITEM_IN_USE: {
    status: 409,
    message: 'Cannot delete a menu item that is referenced by order history',
  },
```

(`MENU_ITEM_NOT_FOUND` already exists under Ordering (US-007); reuse it.)

- [ ] **Step 4: Replace the 4 local copies with the shared import**

In each of `src/application/categories/delete-category.ts`, `src/application/orders/order-session.ts`, `src/application/sessions/resolve-table-session.ts`, `src/application/staff/create-staff.ts`: delete the local `function pgErrorCode(...) {...}` block (and the `/** Drizzle wraps ... */` comment above it in `delete-category.ts`), then import it. Each file already imports from `../../shared/errors` (`AppError`); extend that import. For `delete-category.ts` the import becomes:

```ts
import { AppError, pgErrorCode } from '../../shared/errors'
```

Apply the equivalent edit in the other three files (add `pgErrorCode` to their existing `../../shared/errors` import, or add a new import line if they import `AppError` from a deeper path — check each file's existing import and match it).

- [ ] **Step 5: Run typecheck + the suites covering the touched files**

Run: `bun run typecheck`
Expected: clean (no errors).

Run: `bun test test/categories test/staff test/orders test/sessions 2>&1 | tail -20`
Expected: PASS or self-skip (no DB) — no failures, no `pgErrorCode is not defined`.

- [ ] **Step 6: Commit**

```bash
git add src/shared/errors test/ src/application/categories/delete-category.ts src/application/orders/order-session.ts src/application/sessions/resolve-table-session.ts src/application/staff/create-staff.ts
git commit -m "refactor(errors): shared pgErrorCode helper + MENU_ITEM_IN_USE code"
```

---

### Task 2: `MenuItemView` + mapper

**Files:**
- Create: `src/application/menu-items/menu-item-view.ts`
- Test: `test/menu-items/menu-item-view.test.ts`

**Interfaces:**
- Produces:
  - `interface MenuItemView { id: string; categoryId: string; name: string; description: string | null; price: number; imageUrl: string | null; isAvailable: boolean; sortOrder: number }`
  - `toMenuItemView(row): MenuItemView`

- [ ] **Step 1: Write the failing test**

`test/menu-items/menu-item-view.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'

import { toMenuItemView } from '../../src/application/menu-items/menu-item-view'

describe('toMenuItemView', () => {
  it('maps a row to the admin-facing view', () => {
    const view = toMenuItemView({
      id: 'item-1',
      categoryId: 'cat-1',
      name: 'Pho',
      description: 'Beef noodle soup',
      price: 50000,
      imageUrl: 'https://img/pho.jpg',
      isAvailable: true,
      sortOrder: 2,
    })
    expect(view).toEqual({
      id: 'item-1',
      categoryId: 'cat-1',
      name: 'Pho',
      description: 'Beef noodle soup',
      price: 50000,
      imageUrl: 'https://img/pho.jpg',
      isAvailable: true,
      sortOrder: 2,
    })
  })

  it('preserves null description and imageUrl', () => {
    const view = toMenuItemView({
      id: 'item-2',
      categoryId: 'cat-1',
      name: 'Water',
      description: null,
      price: 0,
      imageUrl: null,
      isAvailable: false,
      sortOrder: 0,
    })
    expect(view.description).toBeNull()
    expect(view.imageUrl).toBeNull()
    expect(view.price).toBe(0)
    expect(view.isAvailable).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/menu-items/menu-item-view.test.ts`
Expected: FAIL — cannot resolve `../../src/application/menu-items/menu-item-view`.

- [ ] **Step 3: Write the implementation**

`src/application/menu-items/menu-item-view.ts`:

```ts
/**
 * Admin-facing shape of a menu item (US-015). Carries `categoryId` so the route can group/move
 * items; `menu_items` has no `restaurantId` (tenancy flows through the category). Nothing here is
 * sensitive. `description`/`imageUrl` are nullable text columns.
 */
export interface MenuItemView {
  id: string
  categoryId: string
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  isAvailable: boolean
  sortOrder: number
}

export function toMenuItemView(row: {
  id: string
  categoryId: string
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  isAvailable: boolean
  sortOrder: number
}): MenuItemView {
  return {
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    price: row.price,
    imageUrl: row.imageUrl,
    isAvailable: row.isAvailable,
    sortOrder: row.sortOrder,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/menu-items/menu-item-view.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/menu-items/menu-item-view.ts test/menu-items/menu-item-view.test.ts
git commit -m "feat(us-015): menu item view mapper"
```

---

### Task 3: `list-menu-items` + `create-menu-item` use-cases

**Files:**
- Create: `src/application/menu-items/list-menu-items.ts`
- Create: `src/application/menu-items/create-menu-item.ts`
- Test: `test/menu-items/menu-item-use-cases.test.ts`

**Interfaces:**
- Consumes: `MenuItemView`, `toMenuItemView` (Task 2); `pgErrorCode` (Task 1); `categories`, `menuItems` from schema; `AppError`.
- Produces:
  - `listMenuItemsUseCase(database, restaurantId: string, categoryId?: string): Promise<MenuItemView[]>`
  - `interface CreateMenuItemInput { categoryId: string; name: string; price: number; description?: string | null; imageUrl?: string | null; isAvailable?: boolean; sortOrder?: number }`
  - `createMenuItemUseCase(database, restaurantId: string, input: CreateMenuItemInput): Promise<MenuItemView>`

- [ ] **Step 1: Write the failing test**

`test/menu-items/menu-item-use-cases.test.ts`:

```ts
import { randomUUID } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { createMenuItemUseCase } from '../../src/application/menu-items/create-menu-item'
import { listMenuItemsUseCase } from '../../src/application/menu-items/list-menu-items'
import { db } from '../../src/infrastructure/database/client'
import { categories, menuItems, restaurants } from '../../src/infrastructure/database/schema'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'

let schemaAvailable = false
let restaurantId = ''
let categoryId = ''
let category2Id = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const [r] = await db
    .insert(restaurants)
    .values({ name: `US-015 UC ${randomUUID()}` })
    .returning({ id: restaurants.id })
  restaurantId = r!.id
  const [c1] = await db
    .insert(categories)
    .values({ restaurantId, name: 'Mains', sortOrder: 0 })
    .returning({ id: categories.id })
  categoryId = c1!.id
  const [c2] = await db
    .insert(categories)
    .values({ restaurantId, name: 'Drinks', sortOrder: 1 })
    .returning({ id: categories.id })
  category2Id = c2!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable || !restaurantId) return
  const cats = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.restaurantId, restaurantId))
  const catIds = cats.map((c) => c.id)
  if (catIds.length) await db.delete(menuItems).where(inArray(menuItems.categoryId, catIds))
  await db.delete(categories).where(eq(categories.restaurantId, restaurantId))
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId))
}, DB_TIMEOUT_MS)

describe('createMenuItemUseCase', () => {
  it(
    'defaults isAvailable=true and sortOrder=0 and scopes to the category',
    async () => {
      if (!schemaAvailable) return
      const created = await createMenuItemUseCase(db, restaurantId, {
        categoryId,
        name: 'Pho',
        price: 50000,
      })
      expect(created.name).toBe('Pho')
      expect(created.price).toBe(50000)
      expect(created.isAvailable).toBe(true)
      expect(created.sortOrder).toBe(0)
      expect(created.categoryId).toBe(categoryId)
      expect(created.description).toBeNull()
      expect(created.imageUrl).toBeNull()
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws CATEGORY_NOT_FOUND when the category belongs to another restaurant',
    async () => {
      if (!schemaAvailable) return
      const [r2] = await db
        .insert(restaurants)
        .values({ name: `US-015 Other ${randomUUID()}` })
        .returning({ id: restaurants.id })
      const [foreignCat] = await db
        .insert(categories)
        .values({ restaurantId: r2!.id, name: 'Foreign', sortOrder: 0 })
        .returning({ id: categories.id })
      await expect(
        createMenuItemUseCase(db, restaurantId, {
          categoryId: foreignCat!.id,
          name: 'Sneaky',
          price: 1000,
        }),
      ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
      await db.delete(categories).where(eq(categories.id, foreignCat!.id))
      await db.delete(restaurants).where(eq(restaurants.id, r2!.id))
    },
    DB_TIMEOUT_MS,
  )
})

describe('listMenuItemsUseCase', () => {
  it(
    'lists all items of the restaurant ordered by category then item, with optional categoryId filter',
    async () => {
      if (!schemaAvailable) return
      await createMenuItemUseCase(db, restaurantId, {
        categoryId: category2Id,
        name: 'Cola',
        price: 15000,
        sortOrder: 1,
      })
      await createMenuItemUseCase(db, restaurantId, {
        categoryId: category2Id,
        name: 'Beer',
        price: 25000,
        sortOrder: 0,
      })

      const all = await listMenuItemsUseCase(db, restaurantId)
      const names = all.map((i) => i.name)
      // category Mains (sortOrder 0) before Drinks (sortOrder 1); within Drinks, Beer (0) before Cola (1)
      expect(names.indexOf('Pho')).toBeLessThan(names.indexOf('Beer'))
      expect(names.indexOf('Beer')).toBeLessThan(names.indexOf('Cola'))

      const drinksOnly = await listMenuItemsUseCase(db, restaurantId, category2Id)
      expect(drinksOnly.every((i) => i.categoryId === category2Id)).toBe(true)
      expect(drinksOnly.some((i) => i.name === 'Pho')).toBe(false)
    },
    DB_TIMEOUT_MS,
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/menu-items/menu-item-use-cases.test.ts`
Expected: FAIL — cannot resolve the new use-case modules (or self-skip with no DB; if it self-skips, you still see the import error first — fix by creating the files).

- [ ] **Step 3: Implement `list-menu-items`**

`src/application/menu-items/list-menu-items.ts`:

```ts
import { and, asc, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { categories, menuItems } from '../../infrastructure/database/schema'
import { type MenuItemView, toMenuItemView } from './menu-item-view'

/**
 * List menu items for a restaurant (US-015). `menu_items` has no `restaurantId`, so tenancy is
 * enforced by joining `categories` and filtering on `categories.restaurantId`. Ordered by category
 * (`sortOrder`, `name`) then item (`sortOrder`, `name`) to mirror the customer menu grouping
 * (US-006). An optional `categoryId` narrows the list to one group.
 */
export async function listMenuItemsUseCase(
  database: Database,
  restaurantId: string,
  categoryId?: string,
): Promise<MenuItemView[]> {
  const where =
    categoryId === undefined
      ? eq(categories.restaurantId, restaurantId)
      : and(eq(categories.restaurantId, restaurantId), eq(menuItems.categoryId, categoryId))

  const rows = await database
    .select({
      id: menuItems.id,
      categoryId: menuItems.categoryId,
      name: menuItems.name,
      description: menuItems.description,
      price: menuItems.price,
      imageUrl: menuItems.imageUrl,
      isAvailable: menuItems.isAvailable,
      sortOrder: menuItems.sortOrder,
    })
    .from(menuItems)
    .innerJoin(categories, eq(categories.id, menuItems.categoryId))
    .where(where)
    .orderBy(
      asc(categories.sortOrder),
      asc(categories.name),
      asc(menuItems.sortOrder),
      asc(menuItems.name),
    )

  return rows.map(toMenuItemView)
}
```

- [ ] **Step 4: Implement `create-menu-item`**

`src/application/menu-items/create-menu-item.ts`:

```ts
import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { categories, menuItems } from '../../infrastructure/database/schema'
import { AppError, pgErrorCode } from '../../shared/errors'
import { type MenuItemView, toMenuItemView } from './menu-item-view'

export interface CreateMenuItemInput {
  categoryId: string
  name: string
  price: number
  description?: string | null
  imageUrl?: string | null
  isAvailable?: boolean
  sortOrder?: number
}

/**
 * Create a menu item in one of the admin's categories (US-015). The target category must belong to
 * `restaurantId` — checked first (the FK on `menu_items.category_id` only proves existence, not
 * tenant) and surfaced as `CATEGORY_NOT_FOUND` (404). SQLSTATE 23503 maps to the same code as a
 * backstop for the category being deleted between the check and the insert (Neon transaction
 * pooling). `isAvailable` defaults true, `sortOrder` defaults 0; `description`/`imageUrl` default null.
 */
export async function createMenuItemUseCase(
  database: Database,
  restaurantId: string,
  input: CreateMenuItemInput,
): Promise<MenuItemView> {
  const [cat] = await database
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, input.categoryId), eq(categories.restaurantId, restaurantId)))
    .limit(1)
  if (!cat) throw new AppError('CATEGORY_NOT_FOUND')

  try {
    const [created] = await database
      .insert(menuItems)
      .values({
        categoryId: input.categoryId,
        name: input.name,
        price: input.price,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        isAvailable: input.isAvailable ?? true,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning()
    return toMenuItemView(created!)
  } catch (error) {
    if (pgErrorCode(error) === '23503') throw new AppError('CATEGORY_NOT_FOUND')
    throw error
  }
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test test/menu-items/menu-item-use-cases.test.ts`
Expected: PASS (or self-skip with no DB).

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/application/menu-items/list-menu-items.ts src/application/menu-items/create-menu-item.ts test/menu-items/menu-item-use-cases.test.ts
git commit -m "feat(us-015): list + create menu-item use-cases"
```

---

### Task 4: `update-menu-item` + `delete-menu-item` use-cases

**Files:**
- Create: `src/application/menu-items/update-menu-item.ts`
- Create: `src/application/menu-items/delete-menu-item.ts`
- Modify: `test/menu-items/menu-item-use-cases.test.ts` (extend with update/delete suites)

**Interfaces:**
- Consumes: `MenuItemView`, `toMenuItemView`, `createMenuItemUseCase`, `listMenuItemsUseCase`; `pgErrorCode`, `AppError`; `categories`, `menuItems`, `orderItems`, `orders`, `tables` from schema.
- Produces:
  - `interface UpdateMenuItemInput { categoryId?: string; name?: string; price?: number; description?: string | null; imageUrl?: string | null; isAvailable?: boolean; sortOrder?: number }`
  - `updateMenuItemUseCase(database, restaurantId: string, id: string, input: UpdateMenuItemInput): Promise<MenuItemView>`
  - `deleteMenuItemUseCase(database, restaurantId: string, id: string): Promise<void>`

- [ ] **Step 1: Write the failing tests (append to the use-case suite)**

Append to `test/menu-items/menu-item-use-cases.test.ts`. First extend the existing imports at the top of the file:

```ts
import { deleteMenuItemUseCase } from '../../src/application/menu-items/delete-menu-item'
import { updateMenuItemUseCase } from '../../src/application/menu-items/update-menu-item'
import { orderItems, orders, tables } from '../../src/infrastructure/database/schema'
```

(Add these alongside the existing imports — `orderItems, orders, tables` join the existing `categories, menuItems, restaurants` import from schema; keep one import statement per module.)

Then append these suites at the end of the file:

```ts
describe('updateMenuItemUseCase', () => {
  it(
    'patches only the fields provided',
    async () => {
      if (!schemaAvailable) return
      const created = await createMenuItemUseCase(db, restaurantId, {
        categoryId,
        name: 'Temp',
        price: 1000,
        sortOrder: 3,
      })
      const updated = await updateMenuItemUseCase(db, restaurantId, created.id, { price: 2000 })
      expect(updated.price).toBe(2000)
      expect(updated.name).toBe('Temp')
      expect(updated.sortOrder).toBe(3)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'moves an item to another of the restaurant categories',
    async () => {
      if (!schemaAvailable) return
      const created = await createMenuItemUseCase(db, restaurantId, {
        categoryId,
        name: 'Movable',
        price: 1000,
      })
      const moved = await updateMenuItemUseCase(db, restaurantId, created.id, {
        categoryId: category2Id,
      })
      expect(moved.categoryId).toBe(category2Id)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws MENU_ITEM_NOT_FOUND for an item owned by another restaurant',
    async () => {
      if (!schemaAvailable) return
      const [r2] = await db
        .insert(restaurants)
        .values({ name: `US-015 Other ${randomUUID()}` })
        .returning({ id: restaurants.id })
      const [foreignCat] = await db
        .insert(categories)
        .values({ restaurantId: r2!.id, name: 'Foreign', sortOrder: 0 })
        .returning({ id: categories.id })
      const foreignItem = await createMenuItemUseCase(db, r2!.id, {
        categoryId: foreignCat!.id,
        name: 'Theirs',
        price: 1000,
      })
      await expect(
        updateMenuItemUseCase(db, restaurantId, foreignItem.id, { name: 'Hijack' }),
      ).rejects.toMatchObject({ code: 'MENU_ITEM_NOT_FOUND' })
      await db.delete(menuItems).where(eq(menuItems.id, foreignItem.id))
      await db.delete(categories).where(eq(categories.id, foreignCat!.id))
      await db.delete(restaurants).where(eq(restaurants.id, r2!.id))
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws CATEGORY_NOT_FOUND when moving into another restaurant category',
    async () => {
      if (!schemaAvailable) return
      const created = await createMenuItemUseCase(db, restaurantId, {
        categoryId,
        name: 'StayHome',
        price: 1000,
      })
      const [r2] = await db
        .insert(restaurants)
        .values({ name: `US-015 Other ${randomUUID()}` })
        .returning({ id: restaurants.id })
      const [foreignCat] = await db
        .insert(categories)
        .values({ restaurantId: r2!.id, name: 'Foreign', sortOrder: 0 })
        .returning({ id: categories.id })
      await expect(
        updateMenuItemUseCase(db, restaurantId, created.id, { categoryId: foreignCat!.id }),
      ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
      await db.delete(categories).where(eq(categories.id, foreignCat!.id))
      await db.delete(restaurants).where(eq(restaurants.id, r2!.id))
    },
    DB_TIMEOUT_MS,
  )
})

describe('deleteMenuItemUseCase', () => {
  it(
    'deletes an item with no order history',
    async () => {
      if (!schemaAvailable) return
      const created = await createMenuItemUseCase(db, restaurantId, {
        categoryId,
        name: 'ToDelete',
        price: 1000,
      })
      await deleteMenuItemUseCase(db, restaurantId, created.id)
      const all = await listMenuItemsUseCase(db, restaurantId)
      expect(all.some((i) => i.id === created.id)).toBe(false)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'refuses to delete an item referenced by order history — MENU_ITEM_IN_USE',
    async () => {
      if (!schemaAvailable) return
      const item = await createMenuItemUseCase(db, restaurantId, {
        categoryId,
        name: 'Ordered',
        price: 1000,
      })
      const [table] = await db
        .insert(tables)
        .values({ restaurantId, name: 'T1', qrToken: `qr-${randomUUID()}` })
        .returning({ id: tables.id })
      const [order] = await db
        .insert(orders)
        .values({ restaurantId, tableId: table!.id })
        .returning({ id: orders.id })
      await db.insert(orderItems).values({
        orderId: order!.id,
        menuItemId: item.id,
        nameSnapshot: item.name,
        unitPrice: item.price,
        quantity: 1,
      })
      await expect(deleteMenuItemUseCase(db, restaurantId, item.id)).rejects.toMatchObject({
        code: 'MENU_ITEM_IN_USE',
      })
      // cleanup the order chain so afterAll can drop categories/restaurant
      await db.delete(orders).where(eq(orders.id, order!.id)) // cascades order_items
      await db.delete(tables).where(eq(tables.id, table!.id))
      await db.delete(menuItems).where(eq(menuItems.id, item.id))
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws MENU_ITEM_NOT_FOUND for an item owned by another restaurant',
    async () => {
      if (!schemaAvailable) return
      const [r2] = await db
        .insert(restaurants)
        .values({ name: `US-015 Other ${randomUUID()}` })
        .returning({ id: restaurants.id })
      const [foreignCat] = await db
        .insert(categories)
        .values({ restaurantId: r2!.id, name: 'Foreign', sortOrder: 0 })
        .returning({ id: categories.id })
      const foreignItem = await createMenuItemUseCase(db, r2!.id, {
        categoryId: foreignCat!.id,
        name: 'Theirs',
        price: 1000,
      })
      await expect(
        deleteMenuItemUseCase(db, restaurantId, foreignItem.id),
      ).rejects.toMatchObject({ code: 'MENU_ITEM_NOT_FOUND' })
      await db.delete(menuItems).where(eq(menuItems.id, foreignItem.id))
      await db.delete(categories).where(eq(categories.id, foreignCat!.id))
      await db.delete(restaurants).where(eq(restaurants.id, r2!.id))
    },
    DB_TIMEOUT_MS,
  )
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/menu-items/menu-item-use-cases.test.ts`
Expected: FAIL — cannot resolve `update-menu-item` / `delete-menu-item`.

- [ ] **Step 3: Implement `update-menu-item`**

`src/application/menu-items/update-menu-item.ts`:

```ts
import { and, eq, exists } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { categories, menuItems } from '../../infrastructure/database/schema'
import { AppError, pgErrorCode } from '../../shared/errors'
import { type MenuItemView, toMenuItemView } from './menu-item-view'

export interface UpdateMenuItemInput {
  categoryId?: string
  name?: string
  price?: number
  description?: string | null
  imageUrl?: string | null
  isAvailable?: boolean
  sortOrder?: number
}

/**
 * Update a menu item (US-015). Tenancy is enforced by an `exists` subquery requiring the item's
 * category to belong to `restaurantId`, so targeting another restaurant's item matches no rows and
 * surfaces as `MENU_ITEM_NOT_FOUND` (404). When `categoryId` is sent (a move), the destination
 * category must also belong to the restaurant, else `CATEGORY_NOT_FOUND` (404); SQLSTATE 23503 maps
 * to the same code as a backstop. Only the fields provided are patched.
 */
export async function updateMenuItemUseCase(
  database: Database,
  restaurantId: string,
  id: string,
  input: UpdateMenuItemInput,
): Promise<MenuItemView> {
  if (input.categoryId !== undefined) {
    const [cat] = await database
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, input.categoryId), eq(categories.restaurantId, restaurantId)))
      .limit(1)
    if (!cat) throw new AppError('CATEGORY_NOT_FOUND')
  }

  const patch: Partial<{
    categoryId: string
    name: string
    price: number
    description: string | null
    imageUrl: string | null
    isAvailable: boolean
    sortOrder: number
  }> = {}
  if (input.categoryId !== undefined) patch.categoryId = input.categoryId
  if (input.name !== undefined) patch.name = input.name
  if (input.price !== undefined) patch.price = input.price
  if (input.description !== undefined) patch.description = input.description
  if (input.imageUrl !== undefined) patch.imageUrl = input.imageUrl
  if (input.isAvailable !== undefined) patch.isAvailable = input.isAvailable
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder

  const inRestaurant = exists(
    database
      .select({ one: categories.id })
      .from(categories)
      .where(and(eq(categories.id, menuItems.categoryId), eq(categories.restaurantId, restaurantId))),
  )
  const scope = and(eq(menuItems.id, id), inRestaurant)

  if (Object.keys(patch).length === 0) {
    const [current] = await database.select().from(menuItems).where(scope).limit(1)
    if (!current) throw new AppError('MENU_ITEM_NOT_FOUND')
    return toMenuItemView(current)
  }

  try {
    const [updated] = await database.update(menuItems).set(patch).where(scope).returning()
    if (!updated) throw new AppError('MENU_ITEM_NOT_FOUND')
    return toMenuItemView(updated)
  } catch (error) {
    if (pgErrorCode(error) === '23503') throw new AppError('CATEGORY_NOT_FOUND')
    throw error
  }
}
```

- [ ] **Step 4: Implement `delete-menu-item`**

`src/application/menu-items/delete-menu-item.ts`:

```ts
import { and, eq, exists } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { categories, menuItems, orderItems } from '../../infrastructure/database/schema'
import { AppError, pgErrorCode } from '../../shared/errors'

/**
 * Delete a menu item (US-015). Tenant-scoped existence check first (the item's category must belong
 * to `restaurantId`) → `MENU_ITEM_NOT_FOUND` (404) for a missing or cross-tenant id. An item still
 * referenced by `order_items` is refused with `MENU_ITEM_IN_USE` (409): we count first for a clean
 * answer, and map the FK violation (SQLSTATE 23503) to the same code so a concurrent order insert
 * between the count and the delete stays safe under Neon's transaction pooling. The item's
 * `option_groups`/`options` cascade away with it.
 */
export async function deleteMenuItemUseCase(
  database: Database,
  restaurantId: string,
  id: string,
): Promise<void> {
  const inRestaurant = exists(
    database
      .select({ one: categories.id })
      .from(categories)
      .where(and(eq(categories.id, menuItems.categoryId), eq(categories.restaurantId, restaurantId))),
  )
  const scope = and(eq(menuItems.id, id), inRestaurant)

  const [current] = await database.select({ id: menuItems.id }).from(menuItems).where(scope).limit(1)
  if (!current) throw new AppError('MENU_ITEM_NOT_FOUND')

  const [used] = await database
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.menuItemId, id))
    .limit(1)
  if (used) throw new AppError('MENU_ITEM_IN_USE')

  try {
    await database.delete(menuItems).where(scope)
  } catch (error) {
    if (pgErrorCode(error) === '23503') throw new AppError('MENU_ITEM_IN_USE')
    throw error
  }
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test test/menu-items/menu-item-use-cases.test.ts`
Expected: PASS (or self-skip with no DB).

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/application/menu-items/update-menu-item.ts src/application/menu-items/delete-menu-item.ts test/menu-items/menu-item-use-cases.test.ts
git commit -m "feat(us-015): update + delete menu-item use-cases (in-use guard)"
```

---

### Task 5: HTTP route + mount + integration tests

**Files:**
- Create: `src/presentation/http/routes/menu-items.ts`
- Modify: `src/presentation/http/app.ts:6-27`
- Test: `test/menu-items/menu-items-routes.integration.test.ts`

**Interfaces:**
- Consumes: `listMenuItemsUseCase`, `createMenuItemUseCase`, `updateMenuItemUseCase`, `deleteMenuItemUseCase`; `db`; `authGuard`.
- Produces: `menuItemsRoutes` (Elysia plugin, prefix `/menu-items`), mounted in `app`.

- [ ] **Step 1: Write the failing integration test**

`test/menu-items/menu-items-routes.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { hashPassword } from '../../src/infrastructure/auth/password'
import { db } from '../../src/infrastructure/database/client'
import {
  categories,
  menuItems,
  orderItems,
  orders,
  restaurants,
  tables,
  users,
} from '../../src/infrastructure/database/schema'
import { app } from '../../src/presentation/http/app'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'
import { errorCode } from '../support/http'

let schemaAvailable = false
const password = 'admin-pw-us015'
const adminAEmail = `admin-a-${randomUUID()}@us015.test`
const adminBEmail = `admin-b-${randomUUID()}@us015.test`
const cashierAEmail = `cashier-a-${randomUUID()}@us015.test`
let restaurantAId = ''
let restaurantBId = ''
let categoryAId = ''
let categoryBId = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const passwordHash = await hashPassword(password)
  const [a] = await db.insert(restaurants).values({ name: 'US-015 A' }).returning({ id: restaurants.id })
  restaurantAId = a!.id
  const [b] = await db.insert(restaurants).values({ name: 'US-015 B' }).returning({ id: restaurants.id })
  restaurantBId = b!.id
  await db.insert(users).values([
    { restaurantId: restaurantAId, email: adminAEmail, passwordHash, name: 'Admin A', role: 'ADMIN' },
    { restaurantId: restaurantAId, email: cashierAEmail, passwordHash, name: 'Cashier A', role: 'CASHIER' },
    { restaurantId: restaurantBId, email: adminBEmail, passwordHash, name: 'Admin B', role: 'ADMIN' },
  ])
  const [catA] = await db
    .insert(categories)
    .values({ restaurantId: restaurantAId, name: 'A Mains', sortOrder: 0 })
    .returning({ id: categories.id })
  categoryAId = catA!.id
  const [catB] = await db
    .insert(categories)
    .values({ restaurantId: restaurantBId, name: 'B Only', sortOrder: 0 })
    .returning({ id: categories.id })
  categoryBId = catB!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable) return
  for (const rid of [restaurantAId, restaurantBId].filter(Boolean)) {
    await db.delete(orders).where(eq(orders.restaurantId, rid)) // cascades order_items
    await db.delete(tables).where(eq(tables.restaurantId, rid))
    const cats = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.restaurantId, rid))
    const catIds = cats.map((c) => c.id)
    if (catIds.length) await db.delete(menuItems).where(inArray(menuItems.categoryId, catIds))
    await db.delete(categories).where(eq(categories.restaurantId, rid))
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

describe('menu-items CRUD', () => {
  it(
    'rejects a non-admin with 403 and a missing token with 401',
    async () => {
      if (!schemaAvailable) return
      const cashier = await tokenFor(cashierAEmail)
      expect((await req('/menu-items', { token: cashier })).status).toBe(403)
      expect((await req('/menu-items')).status).toBe(401)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'creates, lists, updates, and deletes scoped to the admin restaurant',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)

      const created = await req('/menu-items', {
        method: 'POST',
        token,
        body: { categoryId: categoryAId, name: 'Pho', price: 50000 },
      })
      expect(created.status).toBe(201)
      const { data: c } = (await created.json()) as {
        data: { menuItem: { id: string; isAvailable: boolean; sortOrder: number; categoryId: string } }
      }
      expect(c.menuItem.isAvailable).toBe(true)
      expect(c.menuItem.sortOrder).toBe(0)
      expect(c.menuItem.categoryId).toBe(categoryAId)
      const id = c.menuItem.id

      const listed = await req('/menu-items', { token })
      expect(listed.status).toBe(200)
      const { data: l } = (await listed.json()) as {
        data: { menuItems: Array<{ id: string; categoryId: string }> }
      }
      expect(l.menuItems.some((x) => x.id === id)).toBe(true)
      expect(l.menuItems.some((x) => x.categoryId === categoryBId)).toBe(false)

      const patched = await req(`/menu-items/${id}`, {
        method: 'PATCH',
        token,
        body: { price: 55000, isAvailable: false },
      })
      expect(patched.status).toBe(200)
      const { data: p } = (await patched.json()) as {
        data: { menuItem: { price: number; isAvailable: boolean } }
      }
      expect(p.menuItem).toMatchObject({ price: 55000, isAvailable: false })

      const del = await req(`/menu-items/${id}`, { method: 'DELETE', token })
      expect(del.status).toBe(204)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects a price below zero with 400',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const res = await req('/menu-items', {
        method: 'POST',
        token,
        body: { categoryId: categoryAId, name: 'Bad', price: -1 },
      })
      expect(res.status).toBe(400)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'cannot create into another restaurant category — 404 CATEGORY_NOT_FOUND',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const res = await req('/menu-items', {
        method: 'POST',
        token,
        body: { categoryId: categoryBId, name: 'Sneaky', price: 1000 },
      })
      expect(res.status).toBe(404)
      expect(await errorCode(res)).toBe('CATEGORY_NOT_FOUND')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'cannot touch another restaurant item — 404 MENU_ITEM_NOT_FOUND',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const [bItem] = await db
        .insert(menuItems)
        .values({ categoryId: categoryBId, name: 'B Dish', price: 1000 })
        .returning({ id: menuItems.id })
      const res = await req(`/menu-items/${bItem!.id}`, {
        method: 'PATCH',
        token,
        body: { name: 'Hijack' },
      })
      expect(res.status).toBe(404)
      expect(await errorCode(res)).toBe('MENU_ITEM_NOT_FOUND')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'refuses to delete an item referenced by order history — 409 MENU_ITEM_IN_USE',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const [item] = await db
        .insert(menuItems)
        .values({ categoryId: categoryAId, name: 'Ordered', price: 1000 })
        .returning({ id: menuItems.id, name: menuItems.name, price: menuItems.price })
      const [table] = await db
        .insert(tables)
        .values({ restaurantId: restaurantAId, name: 'T1', qrToken: `qr-${randomUUID()}` })
        .returning({ id: tables.id })
      const [order] = await db
        .insert(orders)
        .values({ restaurantId: restaurantAId, tableId: table!.id })
        .returning({ id: orders.id })
      await db.insert(orderItems).values({
        orderId: order!.id,
        menuItemId: item!.id,
        nameSnapshot: item!.name,
        unitPrice: item!.price,
        quantity: 1,
      })
      const res = await req(`/menu-items/${item!.id}`, { method: 'DELETE', token })
      expect(res.status).toBe(409)
      expect(await errorCode(res)).toBe('MENU_ITEM_IN_USE')
    },
    DB_TIMEOUT_MS,
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/menu-items/menu-items-routes.integration.test.ts`
Expected: FAIL — `menuItemsRoutes` not mounted / route 404s (or self-skip with no DB).

- [ ] **Step 3: Implement the route**

`src/presentation/http/routes/menu-items.ts`:

```ts
import { Elysia, t } from 'elysia'

import { createMenuItemUseCase } from '../../../application/menu-items/create-menu-item'
import { deleteMenuItemUseCase } from '../../../application/menu-items/delete-menu-item'
import { listMenuItemsUseCase } from '../../../application/menu-items/list-menu-items'
import { updateMenuItemUseCase } from '../../../application/menu-items/update-menu-item'
import { db } from '../../../infrastructure/database/client'
import { authGuard } from '../plugins/auth-guard'

const menuItemView = t.Object({
  id: t.String({ format: 'uuid' }),
  categoryId: t.String({ format: 'uuid' }),
  name: t.String(),
  description: t.Union([t.String(), t.Null()]),
  price: t.Integer(),
  imageUrl: t.Union([t.String(), t.Null()]),
  isAvailable: t.Boolean(),
  sortOrder: t.Integer(),
})

const listQuery = t.Object({ categoryId: t.Optional(t.String({ format: 'uuid' })) })

const createBody = t.Object({
  categoryId: t.String({ format: 'uuid' }),
  name: t.String({ minLength: 1 }),
  price: t.Integer({ minimum: 0 }),
  description: t.Optional(t.Union([t.String(), t.Null()])),
  imageUrl: t.Optional(t.Union([t.String(), t.Null()])),
  isAvailable: t.Optional(t.Boolean()),
  sortOrder: t.Optional(t.Integer()),
})

const updateBody = t.Object(
  {
    categoryId: t.Optional(t.String({ format: 'uuid' })),
    name: t.Optional(t.String({ minLength: 1 })),
    price: t.Optional(t.Integer({ minimum: 0 })),
    description: t.Optional(t.Union([t.String(), t.Null()])),
    imageUrl: t.Optional(t.Union([t.String(), t.Null()])),
    isAvailable: t.Optional(t.Boolean()),
    sortOrder: t.Optional(t.Integer()),
  },
  { minProperties: 1 },
)

const idParams = t.Object({ id: t.String({ format: 'uuid' }) })

/**
 * Admin menu item administration (US-015). Every route is guarded by `ADMIN` and tenant-scoped:
 * `menu_items` has no `restaurantId`, so tenancy flows through the item's category and the
 * restaurant always comes from `auth.restaurantId`, never the request body/params. Mirrors the
 * US-014 categories route.
 *
 * See docs/product/menu.md (US-6.2).
 */
export const menuItemsRoutes = new Elysia({ prefix: '/menu-items' })
  .use(authGuard)
  .guard({ auth: ['ADMIN'] })
  .get(
    '/',
    async ({ auth, query }) => {
      const menuItems = await listMenuItemsUseCase(db, auth.restaurantId, query.categoryId)
      return { data: { menuItems } }
    },
    {
      query: listQuery,
      detail: { tags: ['Menu Items'], summary: 'List menu items' },
      response: { 200: t.Object({ data: t.Object({ menuItems: t.Array(menuItemView) }) }) },
    },
  )
  .post(
    '/',
    async ({ auth, body, set }) => {
      const menuItem = await createMenuItemUseCase(db, auth.restaurantId, body)
      set.status = 201
      return { data: { menuItem } }
    },
    {
      body: createBody,
      detail: { tags: ['Menu Items'], summary: 'Create a menu item' },
      response: { 201: t.Object({ data: t.Object({ menuItem: menuItemView }) }) },
    },
  )
  .patch(
    '/:id',
    async ({ auth, params, body }) => {
      const menuItem = await updateMenuItemUseCase(db, auth.restaurantId, params.id, body)
      return { data: { menuItem } }
    },
    {
      params: idParams,
      body: updateBody,
      detail: { tags: ['Menu Items'], summary: 'Update a menu item' },
      response: { 200: t.Object({ data: t.Object({ menuItem: menuItemView }) }) },
    },
  )
  .delete(
    '/:id',
    async ({ auth, params, set }) => {
      await deleteMenuItemUseCase(db, auth.restaurantId, params.id)
      set.status = 204
    },
    {
      params: idParams,
      detail: { tags: ['Menu Items'], summary: 'Delete a menu item (blocked if ordered)' },
      response: { 204: t.Void() },
    },
  )
```

- [ ] **Step 4: Mount the route in `app.ts`**

In `src/presentation/http/app.ts`, add the import next to the other route imports (alphabetical, after `kitchenRoutes` is fine — match existing order; `menu-items` sorts after `kitchen`):

```ts
import { menuItemsRoutes } from './routes/menu-items'
```

And add `.use(menuItemsRoutes)` to the chain, right after `.use(categoriesRoutes)`:

```ts
  .use(categoriesRoutes)
  .use(menuItemsRoutes)
  .use(kitchenRoutes)
```

- [ ] **Step 5: Run tests + typecheck + lint**

Run: `bun test test/menu-items`
Expected: PASS (or self-skip with no DB).

Run: `bun run typecheck`
Expected: clean.

Run: `bun run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/presentation/http/routes/menu-items.ts src/presentation/http/app.ts test/menu-items/menu-items-routes.integration.test.ts
git commit -m "feat(us-015): menu-items CRUD route + mount"
```

---

### Task 6: Story packet + validation record + backlog

**Files:**
- Create: `docs/stories/epics/E09-admin-crud/US-015-menu-items-crud/overview.md`
- Create: `docs/stories/epics/E09-admin-crud/US-015-menu-items-crud/validation.md`
- Modify: `docs/stories/backlog.md:23`

**Interfaces:** none (docs only).

- [ ] **Step 1: Write the story overview**

Create `docs/stories/epics/E09-admin-crud/US-015-menu-items-crud/overview.md` summarizing target behavior, endpoints, tenancy-through-category, the delete-in-use guard, and the new `MENU_ITEM_IN_USE` error — adapted from the design spec `docs/superpowers/specs/2026-06-28-us-015-menu-items-crud-design.md` (mirror the structure of `docs/stories/epics/E09-admin-crud/US-014-categories-crud/overview.md`: sections Current Behavior, Target Behavior, Affected Users, Affected Product Docs, Design Notes, Validation table, Harness Delta, Non-Goals).

- [ ] **Step 2: Write the validation record**

Create `docs/stories/epics/E09-admin-crud/US-015-menu-items-crud/validation.md` mirroring `docs/stories/epics/E09-admin-crud/US-014-categories-crud/validation.md`: a table of Layer → proof status → evidence. Fill the evidence from the final `bun test` run (record the exact pass/fail counts) and note unit/integration coverage and DB-suite self-skip behavior.

- [ ] **Step 3: Update the backlog**

In `docs/stories/backlog.md`, line 23, update the E09 row Status to reflect US-015 done and US-016 next. Change:

```
| E09 Admin CRUD | US-014 categories, US-015 menu-items, US-016 options, US-017 tables + QR | slicing (US-014 first) |
```

to:

```
| E09 Admin CRUD | US-014 categories, US-015 menu-items, US-016 options, US-017 tables + QR | slicing (US-014, US-015 done; US-016 next) |
```

- [ ] **Step 4: Run the full suite for the validation evidence**

Run: `bun test 2>&1 | tail -15`
Expected: all pass (or DB suites self-skip if no DB) — record the counts into `validation.md`.

- [ ] **Step 5: Commit**

```bash
git add docs/stories
git commit -m "docs(us-015): story packet + validation record + backlog"
```

---

## Self-Review

**1. Spec coverage:**
- Tenancy through category (no `restaurantId` on `menu_items`) → Tasks 3/4/5 use `exists`/join + category pre-check. ✓
- GET list all + optional `?categoryId`, ordered category→item → Task 3 `listMenuItemsUseCase` + Task 5 `listQuery`. ✓
- POST create with category tenant check, 201, defaults → Task 3 + Task 5. ✓
- PATCH partial patch + move + minProperties 1 → Task 4 + Task 5 `updateBody`. ✓
- DELETE 204 + `409 MENU_ITEM_IN_USE` (count guard + 23503), cascade option_groups → Task 4 `deleteMenuItemUseCase`. ✓
- `price` integer ≥ 0 → Task 5 `t.Integer({ minimum: 0 })` + 400 test. ✓
- Cross-tenant → 404 (MENU_ITEM_NOT_FOUND / CATEGORY_NOT_FOUND) → Tasks 4/5 tests. ✓
- New error `MENU_ITEM_IN_USE` (409); reuse existing `MENU_ITEM_NOT_FOUND`, `CATEGORY_NOT_FOUND` → Task 1. ✓
- RBAC ADMIN-only (401/403) → Task 5 test. ✓
- No migration → confirmed; not in any task. ✓
- `pgErrorCode` consolidation (on-path, 4 identical copies + 3 new call sites) → Task 1. ✓

**2. Placeholder scan:** No TBD/TODO; every code step has full code. Task 6 steps 1–2 reference existing US-014 docs as the structural template rather than repeating 60 lines of prose — acceptable for a docs task whose exact wording is derived from the already-written design spec.

**3. Type consistency:** `MenuItemView` fields identical across view/list/create/update and the route's `menuItemView` t.Object. Use-case signatures match the Interfaces blocks. Response keys: `{ data: { menuItems } }` (list), `{ data: { menuItem } }` (create/update) — consistent between Task 5 route and integration test. `listMenuItemsUseCase(db, restaurantId, categoryId?)` arity matches route call. ✓
