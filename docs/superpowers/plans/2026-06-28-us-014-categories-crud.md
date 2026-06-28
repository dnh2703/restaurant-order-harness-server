# US-014 Admin Categories CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `ADMIN` full CRUD over menu categories through `/api/categories`, tenant-scoped, blocking deletion of a category that still has dishes.

**Architecture:** Mirror the US-010 staff-admin slice exactly — thin Elysia route under `authGuard` + `.guard({ auth: ['ADMIN'] })`, delegating to small per-action use-cases in `src/application/categories/`. Tenant scope comes only from `auth.restaurantId`. The `categories` table already exists, so no migration. Integration proof self-skips without a migrated `DATABASE_URL`, identical to `test/staff/staff-admin.integration.test.ts`.

**Tech Stack:** Bun + ElysiaJS, Drizzle ORM on Neon/Postgres, `bun:test`.

## Global Constraints

- Tenant scope is ALWAYS `auth.restaurantId` from token claims — never from body/params.
- Cross-tenant target → `404 CATEGORY_NOT_FOUND` (never reveal another tenant's rows).
- Money/ordering ints only; `sortOrder` is `integer`, default `0`.
- Neon runs PgBouncer transaction pooling: use single autocommit statements, not multi-statement transactions; rely on DB constraints (FK) as the race-safe backstop, not just read-then-write guards.
- All responses use the `{ data: ... }` envelope; errors use the shared `AppError`/error-catalog envelope (`{ error: { code } }`).
- Run `bun test`, `bun run typecheck`, `bun run lint` before each commit; commits are conventional-commit style (`feat(us-014): ...`).

---

### Task 1: Error codes + category view

**Files:**
- Modify: `src/shared/errors/error-catalog.ts`
- Create: `src/application/categories/category-view.ts`
- Test: `test/categories/category-view.test.ts`

**Interfaces:**
- Produces: `CategoryView` = `{ id: string; restaurantId: string; name: string; sortOrder: number }`; `toCategoryView(row): CategoryView`.
- Produces: error codes `CATEGORY_NOT_FOUND` (404), `CATEGORY_NOT_EMPTY` (409).

- [ ] **Step 1: Write the failing test**

```ts
// test/categories/category-view.test.ts
import { describe, expect, it } from 'bun:test'

import { toCategoryView } from '../../src/application/categories/category-view'

describe('toCategoryView', () => {
  it('maps a row to the admin-facing view', () => {
    const view = toCategoryView({
      id: 'cat-1',
      restaurantId: 'rest-1',
      name: 'Drinks',
      sortOrder: 3,
    })
    expect(view).toEqual({ id: 'cat-1', restaurantId: 'rest-1', name: 'Drinks', sortOrder: 3 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/categories/category-view.test.ts`
Expected: FAIL — cannot resolve `../../src/application/categories/category-view`.

- [ ] **Step 3: Add the error codes**

In `src/shared/errors/error-catalog.ts`, add after the Staff administration block:

```ts
  // Menu category administration (US-014)
  CATEGORY_NOT_FOUND: { status: 404, message: 'Category not found' },
  CATEGORY_NOT_EMPTY: {
    status: 409,
    message: 'Cannot delete a category that still has menu items',
  },
```

- [ ] **Step 4: Write the view**

```ts
// src/application/categories/category-view.ts
/**
 * Admin-facing shape of a menu category (US-014). Carries `restaurantId` so the route can
 * assert tenant ownership in responses; excludes nothing sensitive (categories hold no secrets).
 */
export interface CategoryView {
  id: string
  restaurantId: string
  name: string
  sortOrder: number
}

export function toCategoryView(row: {
  id: string
  restaurantId: string
  name: string
  sortOrder: number
}): CategoryView {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    name: row.name,
    sortOrder: row.sortOrder,
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/categories/category-view.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/errors/error-catalog.ts src/application/categories/category-view.ts test/categories/category-view.test.ts
git commit -m "feat(us-014): category view + CATEGORY_NOT_FOUND/NOT_EMPTY error codes"
```

---

### Task 2: List + create use-cases

**Files:**
- Create: `src/application/categories/list-categories.ts`
- Create: `src/application/categories/create-category.ts`
- Test: `test/categories/category-use-cases.test.ts`

**Interfaces:**
- Consumes: `toCategoryView`, `CategoryView` from Task 1; `Database` from `src/infrastructure/database/client`; `categories` table from `src/infrastructure/database/schema`.
- Produces:
  - `listCategoriesUseCase(database, restaurantId): Promise<CategoryView[]>` — ordered by `sortOrder` then `name`.
  - `createCategoryUseCase(database, restaurantId, input): Promise<CategoryView>` where `input = { name: string; sortOrder?: number }`; `sortOrder` defaults to `0`.

- [ ] **Step 1: Write the failing test (self-skipping, DB-backed)**

```ts
// test/categories/category-use-cases.test.ts
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { createCategoryUseCase } from '../../src/application/categories/create-category'
import { listCategoriesUseCase } from '../../src/application/categories/list-categories'
import { db } from '../../src/infrastructure/database/client'
import { categories, restaurants } from '../../src/infrastructure/database/schema'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'

let schemaAvailable = false
let restaurantId = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const [r] = await db
    .insert(restaurants)
    .values({ name: `US-014 UC ${randomUUID()}` })
    .returning({ id: restaurants.id })
  restaurantId = r!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable || !restaurantId) return
  await db.delete(categories).where(eq(categories.restaurantId, restaurantId))
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId))
}, DB_TIMEOUT_MS)

describe('createCategoryUseCase', () => {
  it(
    'defaults sortOrder to 0 and scopes to the restaurant',
    async () => {
      if (!schemaAvailable) return
      const created = await createCategoryUseCase(db, restaurantId, { name: 'Mains' })
      expect(created.name).toBe('Mains')
      expect(created.sortOrder).toBe(0)
      expect(created.restaurantId).toBe(restaurantId)
    },
    DB_TIMEOUT_MS,
  )
})

describe('listCategoriesUseCase', () => {
  it(
    'returns the restaurant categories ordered by sortOrder then name',
    async () => {
      if (!schemaAvailable) return
      await createCategoryUseCase(db, restaurantId, { name: 'Zeta', sortOrder: 1 })
      await createCategoryUseCase(db, restaurantId, { name: 'Alpha', sortOrder: 5 })
      const list = await listCategoriesUseCase(db, restaurantId)
      const names = list.map((c) => c.name)
      // sortOrder 0 (Mains) first, then 1 (Zeta), then 5 (Alpha)
      expect(names.indexOf('Mains')).toBeLessThan(names.indexOf('Zeta'))
      expect(names.indexOf('Zeta')).toBeLessThan(names.indexOf('Alpha'))
      for (const c of list) expect(c.restaurantId).toBe(restaurantId)
    },
    DB_TIMEOUT_MS,
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/categories/category-use-cases.test.ts`
Expected: FAIL — cannot resolve the use-case modules. (If no DB, suite self-skips green; that is acceptable but the resolve error must be fixed before relying on it.)

- [ ] **Step 3: Write `list-categories.ts`**

```ts
// src/application/categories/list-categories.ts
import { asc, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { categories } from '../../infrastructure/database/schema'
import { type CategoryView, toCategoryView } from './category-view'

/**
 * List every category in a restaurant (US-014), ordered by `sortOrder` then `name` so the
 * admin list matches the customer menu grouping (US-006). Scoped to `restaurantId` from the
 * authenticated admin's claims.
 */
export async function listCategoriesUseCase(
  database: Database,
  restaurantId: string,
): Promise<CategoryView[]> {
  const rows = await database
    .select()
    .from(categories)
    .where(eq(categories.restaurantId, restaurantId))
    .orderBy(asc(categories.sortOrder), asc(categories.name))
  return rows.map(toCategoryView)
}
```

- [ ] **Step 4: Write `create-category.ts`**

```ts
// src/application/categories/create-category.ts
import type { Database } from '../../infrastructure/database/client'
import { categories } from '../../infrastructure/database/schema'
import { type CategoryView, toCategoryView } from './category-view'

export interface CreateCategoryInput {
  name: string
  sortOrder?: number
}

/**
 * Create a category in the admin's restaurant (US-014). `restaurantId` comes from the
 * authenticated admin's claims, never the request body; `sortOrder` defaults to 0.
 */
export async function createCategoryUseCase(
  database: Database,
  restaurantId: string,
  input: CreateCategoryInput,
): Promise<CategoryView> {
  const [created] = await database
    .insert(categories)
    .values({
      restaurantId,
      name: input.name,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning()
  return toCategoryView(created!)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/categories/category-use-cases.test.ts`
Expected: PASS (or self-skip if no DB). Also run `bun run typecheck` — expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/application/categories/list-categories.ts src/application/categories/create-category.ts test/categories/category-use-cases.test.ts
git commit -m "feat(us-014): list + create category use-cases (tenant-scoped)"
```

---

### Task 3: Update + delete use-cases

**Files:**
- Create: `src/application/categories/update-category.ts`
- Create: `src/application/categories/delete-category.ts`
- Modify: `test/categories/category-use-cases.test.ts` (add describe blocks)

**Interfaces:**
- Consumes: Task 1 + Task 2 exports; `menuItems` table from schema; `AppError` from `src/shared/errors`.
- Produces:
  - `updateCategoryUseCase(database, restaurantId, id, input): Promise<CategoryView>` where `input = { name?: string; sortOrder?: number }`; missing/cross-tenant id → `AppError('CATEGORY_NOT_FOUND')`.
  - `deleteCategoryUseCase(database, restaurantId, id): Promise<void>`; missing/cross-tenant id → `CATEGORY_NOT_FOUND`; category with ≥1 `menu_items` → `CATEGORY_NOT_EMPTY`.

- [ ] **Step 1: Write the failing tests (append to the use-cases suite)**

Add these `describe` blocks to `test/categories/category-use-cases.test.ts`, and add the imports `import { updateCategoryUseCase } from '../../src/application/categories/update-category'`, `import { deleteCategoryUseCase } from '../../src/application/categories/delete-category'`, `import { menuItems } from '../../src/infrastructure/database/schema'`, and `import { AppError } from '../../src/shared/errors'` at the top. Extend the `afterAll` to delete `menuItems` for the created categories before deleting categories:

```ts
describe('updateCategoryUseCase', () => {
  it(
    'patches only the fields provided',
    async () => {
      if (!schemaAvailable) return
      const created = await createCategoryUseCase(db, restaurantId, { name: 'Temp', sortOrder: 2 })
      const updated = await updateCategoryUseCase(db, restaurantId, created.id, { name: 'Renamed' })
      expect(updated.name).toBe('Renamed')
      expect(updated.sortOrder).toBe(2)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws CATEGORY_NOT_FOUND for an unknown id',
    async () => {
      if (!schemaAvailable) return
      const call = updateCategoryUseCase(db, restaurantId, randomUUID(), { name: 'x' })
      await expect(call).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
    },
    DB_TIMEOUT_MS,
  )
})

describe('deleteCategoryUseCase', () => {
  it(
    'deletes an empty category',
    async () => {
      if (!schemaAvailable) return
      const created = await createCategoryUseCase(db, restaurantId, { name: 'ToDelete' })
      await deleteCategoryUseCase(db, restaurantId, created.id)
      const after = await listCategoriesUseCase(db, restaurantId)
      expect(after.some((c) => c.id === created.id)).toBe(false)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'refuses to delete a category that still has menu items — CATEGORY_NOT_EMPTY',
    async () => {
      if (!schemaAvailable) return
      const created = await createCategoryUseCase(db, restaurantId, { name: 'HasItems' })
      await db.insert(menuItems).values({ categoryId: created.id, name: 'Dish', price: 1000 })
      const call = deleteCategoryUseCase(db, restaurantId, created.id)
      await expect(call).rejects.toMatchObject({ code: 'CATEGORY_NOT_EMPTY' })
    },
    DB_TIMEOUT_MS,
  )
})
```

Update `afterAll` body to clear dependent menu items first:

```ts
afterAll(async () => {
  if (!schemaAvailable || !restaurantId) return
  const cats = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.restaurantId, restaurantId))
  for (const c of cats) await db.delete(menuItems).where(eq(menuItems.categoryId, c.id))
  await db.delete(categories).where(eq(categories.restaurantId, restaurantId))
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId))
}, DB_TIMEOUT_MS)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/categories/category-use-cases.test.ts`
Expected: FAIL — cannot resolve `update-category` / `delete-category`.

- [ ] **Step 3: Write `update-category.ts`**

```ts
// src/application/categories/update-category.ts
import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { categories } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { type CategoryView, toCategoryView } from './category-view'

export interface UpdateCategoryInput {
  name?: string
  sortOrder?: number
}

/**
 * Update a category (US-014). Tenant-scoped: the WHERE matches both `id` and the admin's
 * `restaurantId`, so targeting another restaurant's category matches no rows and surfaces as
 * `CATEGORY_NOT_FOUND` (404) — identical to a truly missing id, leaking nothing cross-tenant.
 */
export async function updateCategoryUseCase(
  database: Database,
  restaurantId: string,
  id: string,
  input: UpdateCategoryInput,
): Promise<CategoryView> {
  const patch: Partial<{ name: string; sortOrder: number }> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder

  const scope = and(eq(categories.id, id), eq(categories.restaurantId, restaurantId))

  if (Object.keys(patch).length === 0) {
    const [current] = await database.select().from(categories).where(scope).limit(1)
    if (!current) throw new AppError('CATEGORY_NOT_FOUND')
    return toCategoryView(current)
  }

  const [updated] = await database.update(categories).set(patch).where(scope).returning()
  if (!updated) throw new AppError('CATEGORY_NOT_FOUND')
  return toCategoryView(updated)
}
```

- [ ] **Step 4: Write `delete-category.ts`**

```ts
// src/application/categories/delete-category.ts
import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { categories, menuItems } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'

/** Drizzle wraps driver errors; the pg error (with its SQLSTATE `code`) is the cause. */
function pgErrorCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } }
  return e.code ?? e.cause?.code
}

/**
 * Delete a category (US-014). Tenant-scoped existence check first → `CATEGORY_NOT_FOUND` (404)
 * for a missing or cross-tenant id. A category that still has `menu_items` is refused with
 * `CATEGORY_NOT_EMPTY` (409): we count first for a clean answer, and also map the FK violation
 * (SQLSTATE 23503) to the same code so a concurrent insert between the count and the delete is
 * still safe under Neon's transaction pooling.
 */
export async function deleteCategoryUseCase(
  database: Database,
  restaurantId: string,
  id: string,
): Promise<void> {
  const scope = and(eq(categories.id, id), eq(categories.restaurantId, restaurantId))

  const [current] = await database.select({ id: categories.id }).from(categories).where(scope).limit(1)
  if (!current) throw new AppError('CATEGORY_NOT_FOUND')

  const [item] = await database
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(eq(menuItems.categoryId, id))
    .limit(1)
  if (item) throw new AppError('CATEGORY_NOT_EMPTY')

  try {
    await database.delete(categories).where(scope)
  } catch (error) {
    if (pgErrorCode(error) === '23503') throw new AppError('CATEGORY_NOT_EMPTY')
    throw error
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/categories/category-use-cases.test.ts && bun run typecheck`
Expected: PASS / clean (or self-skip if no DB).

- [ ] **Step 6: Commit**

```bash
git add src/application/categories/update-category.ts src/application/categories/delete-category.ts test/categories/category-use-cases.test.ts
git commit -m "feat(us-014): update + delete category use-cases (non-empty guard)"
```

---

### Task 4: HTTP route + mount

**Files:**
- Create: `src/presentation/http/routes/categories.ts`
- Modify: `src/presentation/http/app.ts`
- Test: `test/categories/categories-routes.integration.test.ts`

**Interfaces:**
- Consumes: all four use-cases from Tasks 2–3; `authGuard` from `src/presentation/http/plugins/auth-guard`; `db` from `src/infrastructure/database/client`.
- Produces: `categoriesRoutes` Elysia instance with prefix `/categories`, mounted in `app`.
- Wire contract: `GET /api/categories` → `{ data: { categories: CategoryView[] } }`; `POST` → `201 { data: { category } }`; `PATCH /:id` → `{ data: { category } }`; `DELETE /:id` → `204` (no body).

- [ ] **Step 1: Write the failing integration test (self-skipping, two-tenant)**

```ts
// test/categories/categories-routes.integration.test.ts
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { hashPassword } from '../../src/infrastructure/auth/password'
import { db } from '../../src/infrastructure/database/client'
import { categories, menuItems, restaurants, users } from '../../src/infrastructure/database/schema'
import { app } from '../../src/presentation/http/app'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'
import { errorCode } from '../support/http'

let schemaAvailable = false
const password = 'admin-pw-us014'
const adminAEmail = `admin-a-${randomUUID()}@us014.test`
const adminBEmail = `admin-b-${randomUUID()}@us014.test`
const cashierAEmail = `cashier-a-${randomUUID()}@us014.test`
let restaurantAId = ''
let restaurantBId = ''
let categoryBId = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const passwordHash = await hashPassword(password)
  const [a] = await db.insert(restaurants).values({ name: 'US-014 A' }).returning({ id: restaurants.id })
  restaurantAId = a!.id
  const [b] = await db.insert(restaurants).values({ name: 'US-014 B' }).returning({ id: restaurants.id })
  restaurantBId = b!.id
  await db.insert(users).values([
    { restaurantId: restaurantAId, email: adminAEmail, passwordHash, name: 'Admin A', role: 'ADMIN' },
    { restaurantId: restaurantAId, email: cashierAEmail, passwordHash, name: 'Cashier A', role: 'CASHIER' },
    { restaurantId: restaurantBId, email: adminBEmail, passwordHash, name: 'Admin B', role: 'ADMIN' },
  ])
  const [catB] = await db
    .insert(categories)
    .values({ restaurantId: restaurantBId, name: 'B Only', sortOrder: 0 })
    .returning({ id: categories.id })
  categoryBId = catB!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable) return
  for (const rid of [restaurantAId, restaurantBId].filter(Boolean)) {
    const cats = await db.select({ id: categories.id }).from(categories).where(eq(categories.restaurantId, rid))
    for (const c of cats) await db.delete(menuItems).where(eq(menuItems.categoryId, c.id))
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

describe('categories CRUD', () => {
  it('rejects a non-admin with 403 and a missing token with 401', async () => {
    if (!schemaAvailable) return
    const cashier = await tokenFor(cashierAEmail)
    expect((await req('/categories', { token: cashier })).status).toBe(403)
    expect((await req('/categories')).status).toBe(401)
  }, DB_TIMEOUT_MS)

  it('creates, lists, updates, and deletes scoped to the admin restaurant', async () => {
    if (!schemaAvailable) return
    const token = await tokenFor(adminAEmail)

    const created = await req('/categories', { method: 'POST', token, body: { name: 'Drinks' } })
    expect(created.status).toBe(201)
    const { data: c } = (await created.json()) as { data: { category: { id: string; sortOrder: number; restaurantId: string } } }
    expect(c.category.sortOrder).toBe(0)
    expect(c.category.restaurantId).toBe(restaurantAId)
    const id = c.category.id

    const listed = await req('/categories', { token })
    expect(listed.status).toBe(200)
    const { data: l } = (await listed.json()) as { data: { categories: Array<{ id: string; restaurantId: string }> } }
    expect(l.categories.some((x) => x.id === id)).toBe(true)
    for (const x of l.categories) expect(x.restaurantId).toBe(restaurantAId)
    expect(l.categories.some((x) => x.id === categoryBId)).toBe(false)

    const patched = await req(`/categories/${id}`, { method: 'PATCH', token, body: { name: 'Beverages', sortOrder: 4 } })
    expect(patched.status).toBe(200)
    const { data: p } = (await patched.json()) as { data: { category: { name: string; sortOrder: number } } }
    expect(p.category).toMatchObject({ name: 'Beverages', sortOrder: 4 })

    const del = await req(`/categories/${id}`, { method: 'DELETE', token })
    expect(del.status).toBe(204)
  }, DB_TIMEOUT_MS)

  it('cannot touch another restaurant category — 404 CATEGORY_NOT_FOUND', async () => {
    if (!schemaAvailable) return
    const token = await tokenFor(adminAEmail)
    const res = await req(`/categories/${categoryBId}`, { method: 'PATCH', token, body: { name: 'Hijack' } })
    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('CATEGORY_NOT_FOUND')
  }, DB_TIMEOUT_MS)

  it('refuses to delete a category that still has menu items — 409 CATEGORY_NOT_EMPTY', async () => {
    if (!schemaAvailable) return
    const token = await tokenFor(adminAEmail)
    const created = await req('/categories', { method: 'POST', token, body: { name: 'HasItems' } })
    const { data: c } = (await created.json()) as { data: { category: { id: string } } }
    await db.insert(menuItems).values({ categoryId: c.category.id, name: 'Dish', price: 1000 })
    const res = await req(`/categories/${c.category.id}`, { method: 'DELETE', token })
    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('CATEGORY_NOT_EMPTY')
  }, DB_TIMEOUT_MS)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/categories/categories-routes.integration.test.ts`
Expected: FAIL — cannot resolve `routes/categories` (route not created / not mounted).

- [ ] **Step 3: Write the route**

```ts
// src/presentation/http/routes/categories.ts
import { Elysia, t } from 'elysia'

import { createCategoryUseCase } from '../../../application/categories/create-category'
import { deleteCategoryUseCase } from '../../../application/categories/delete-category'
import { listCategoriesUseCase } from '../../../application/categories/list-categories'
import { updateCategoryUseCase } from '../../../application/categories/update-category'
import { db } from '../../../infrastructure/database/client'
import { authGuard } from '../plugins/auth-guard'

const categoryView = t.Object({
  id: t.String({ format: 'uuid' }),
  restaurantId: t.String({ format: 'uuid' }),
  name: t.String(),
  sortOrder: t.Integer(),
})

const createBody = t.Object({
  name: t.String({ minLength: 1 }),
  sortOrder: t.Optional(t.Integer()),
})

const updateBody = t.Object(
  {
    name: t.Optional(t.String({ minLength: 1 })),
    sortOrder: t.Optional(t.Integer()),
  },
  { minProperties: 1 },
)

const idParams = t.Object({ id: t.String({ format: 'uuid' }) })

/**
 * Admin menu category administration (US-014). Every route is guarded by `ADMIN` and
 * tenant-scoped: the restaurant always comes from the authenticated admin's token claims
 * (`auth.restaurantId`), never the request body/params. Mirrors the US-010 staff route.
 *
 * See docs/product/menu.md (US-6.1).
 */
export const categoriesRoutes = new Elysia({ prefix: '/categories' })
  .use(authGuard)
  .guard({ auth: ['ADMIN'] })
  .get(
    '/',
    async ({ auth }) => {
      const categories = await listCategoriesUseCase(db, auth.restaurantId)
      return { data: { categories } }
    },
    {
      detail: { tags: ['Categories'], summary: 'List menu categories' },
      response: { 200: t.Object({ data: t.Object({ categories: t.Array(categoryView) }) }) },
    },
  )
  .post(
    '/',
    async ({ auth, body, set }) => {
      const category = await createCategoryUseCase(db, auth.restaurantId, body)
      set.status = 201
      return { data: { category } }
    },
    {
      body: createBody,
      detail: { tags: ['Categories'], summary: 'Create a menu category' },
      response: { 201: t.Object({ data: t.Object({ category: categoryView }) }) },
    },
  )
  .patch(
    '/:id',
    async ({ auth, params, body }) => {
      const category = await updateCategoryUseCase(db, auth.restaurantId, params.id, body)
      return { data: { category } }
    },
    {
      params: idParams,
      body: updateBody,
      detail: { tags: ['Categories'], summary: 'Update a menu category' },
      response: { 200: t.Object({ data: t.Object({ category: categoryView }) }) },
    },
  )
  .delete(
    '/:id',
    async ({ auth, params, set }) => {
      await deleteCategoryUseCase(db, auth.restaurantId, params.id)
      set.status = 204
    },
    {
      params: idParams,
      detail: { tags: ['Categories'], summary: 'Delete a menu category (blocked if it has items)' },
      response: { 204: t.Void() },
    },
  )
```

- [ ] **Step 4: Mount the route in `app.ts`**

Add the import alongside the others and `.use(categoriesRoutes)` after `.use(staffRoutes)`:

```ts
import { categoriesRoutes } from './routes/categories'
```

```ts
  .use(staffRoutes)
  .use(categoriesRoutes)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/categories/ && bun run typecheck && bun run lint`
Expected: PASS / clean (integration self-skips if no DB).

- [ ] **Step 6: Commit**

```bash
git add src/presentation/http/routes/categories.ts src/presentation/http/app.ts test/categories/categories-routes.integration.test.ts
git commit -m "feat(us-014): categories CRUD route + mount"
```

---

### Task 5: Full suite + story validation record

**Files:**
- Create: `docs/stories/epics/E09-admin-crud/US-014-categories-crud/validation.md`

**Interfaces:** none (documentation + verification only).

- [ ] **Step 1: Run the full test suite, typecheck, and lint**

Run: `bun test && bun run typecheck && bun run lint`
Expected: all green. Capture the categories suite line count for the evidence section.

- [ ] **Step 2: Write the validation record**

```markdown
# Validation — US-014 Admin Categories CRUD

## Proof Status

`scripts/bin/harness-cli story update --id US-014 --unit 1 --integration 1 --e2e 0 --platform 0`

| Layer | Proof |
| --- | --- |
| Unit | `test/categories/category-view.test.ts` — view mapping. |
| Integration | `test/categories/category-use-cases.test.ts` (use-case behavior incl. sortOrder default, tenant 404, non-empty guard) and `test/categories/categories-routes.integration.test.ts` (HTTP CRUD, RBAC 403/401, cross-tenant 404, non-empty 409). |
| E2E | Deferred — covered indirectly: customer menu read (US-006) already proven; admin-created category surfaces on next read. |
| Platform | n/a |

## Evidence

- `bun test` — <paste pass summary>.
- `bun run typecheck`, `bun run lint` — clean.
```

- [ ] **Step 3: Update the story packet status**

In `docs/stories/epics/E09-admin-crud/US-014-categories-crud/overview.md`, no status field exists in the overview; record completion in the validation file above and via the harness CLI command in Step 2 (run it if the harness DB is available; a clean skip is acceptable per AGENT.md).

- [ ] **Step 4: Commit**

```bash
git add docs/stories/epics/E09-admin-crud/US-014-categories-crud/validation.md
git commit -m "docs(us-014): validation record for categories CRUD"
```

---

## Self-Review Notes

- **Spec coverage:** list/create/update/delete (US-6.1) → Tasks 2–4; tenant scope → every use-case + route test; delete non-empty 409 → Task 3 + Task 4; RBAC ADMIN-only → Task 4 (403/401 test); error codes → Task 1. No migration needed (table exists) — confirmed against `schema.ts:111`.
- **Type consistency:** `CategoryView` shape `{ id, restaurantId, name, sortOrder }` is identical across view, use-cases, route `categoryView` t.Object, and tests. Use-case names (`listCategoriesUseCase`, `createCategoryUseCase`, `updateCategoryUseCase`, `deleteCategoryUseCase`) match between definitions, the route imports, and the plan's Interfaces blocks.
- **No placeholders:** every step carries real code or an exact command.
```
