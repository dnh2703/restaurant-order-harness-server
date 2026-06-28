# US-016 Admin Option-Groups & Options CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an `ADMIN` full runtime CRUD over a dish's option groups (SINGLE/MULTI, required-or-not) and the options beneath them (name, priceDelta), scoped to their own restaurant, under `/api/menu-items/:menuItemId/option-groups[...]`.

**Architecture:** Layered, mirroring US-015 menu-items. New use-cases under `src/application/option-groups/`, one Elysia route file (prefix `/menu-items`) mounted in `app.ts`. Neither `option_groups` nor `options` has a `restaurantId` — tenancy flows one join deeper than US-015: `option → option_group → menu_item → category → restaurant`. A small `scope.ts` helper enforces it (`assertMenuItemInRestaurant`, `assertGroupInRestaurant`). Deletes are never blocked by order history (`order_item_options` snapshots text/int with no FK), and the schema already cascades `menu_item → option_groups → options`.

**Tech Stack:** Bun, ElysiaJS, Drizzle ORM on Neon/PostgreSQL, `bun:test`.

## Global Constraints

- Tenant scope ALWAYS comes from `auth.restaurantId` (token claims), never request body/params.
- Money is `integer` VND, never float. `priceDelta` is an integer and **may be negative** (no `minimum`).
- Success envelope `{ data }`; error envelope `{ error: { code } }`; error codes are SCREAMING_SNAKE keys in `src/shared/errors/error-catalog.ts`, thrown via `new AppError('CODE')`.
- Neon runs PgBouncer transaction pooling: write single autocommit statements (no multi-statement transactions); map SQLSTATE 23503 (FK violation) only as a race-safe backstop, never the primary guard. `pgErrorCode(error)` is already exported from `src/shared/errors`.
- DB-backed test suites self-skip via `probeMigratedDb()` and use `DB_TIMEOUT_MS` / `WARMUP_TIMEOUT_MS` from `test/support/db.ts`, so a plain `bun test` stays green with no DB.
- Cross-tenant or missing targets return the same `404` (never reveal another tenant's rows): wrong/missing menu item → `MENU_ITEM_NOT_FOUND`; wrong/missing group → `OPTION_GROUP_NOT_FOUND`; wrong/missing option → `OPTION_NOT_FOUND`. Check order on nested routes: menu item → group → option.
- All routes guarded by `authGuard` + `.guard({ auth: ['ADMIN'] })`.
- No migration: `option_groups` (`id, menuItemId, name, type, isRequired`) and `options` (`id, optionGroupId, name, priceDelta`) already exist; both FKs are `onDelete: 'cascade'`. The `option_group_type` enum is `['SINGLE','MULTI']`.

## File Structure

- `src/shared/errors/error-catalog.ts` — add `OPTION_GROUP_NOT_FOUND` (404), `OPTION_NOT_FOUND` (404).
- `src/application/option-groups/option-group-view.ts` — view interfaces + mappers.
- `src/application/option-groups/scope.ts` — `assertMenuItemInRestaurant`, `assertGroupInRestaurant` tenancy guards.
- `src/application/option-groups/list-option-groups.ts` — list groups (with nested options) of an item.
- `src/application/option-groups/create-option-group.ts` — create a group under an item.
- `src/application/option-groups/update-option-group.ts` — partial patch a group.
- `src/application/option-groups/delete-option-group.ts` — delete a group (cascades options).
- `src/application/option-groups/create-option.ts` — create an option under a group.
- `src/application/option-groups/update-option.ts` — partial patch an option.
- `src/application/option-groups/delete-option.ts` — delete an option.
- `src/presentation/http/routes/option-groups.ts` — Elysia route (prefix `/menu-items`).
- `src/presentation/http/app.ts` — mount `optionGroupsRoutes`.
- `test/option-groups/option-group-view.test.ts`, `test/option-groups/option-group-use-cases.test.ts`, `test/option-groups/option-groups-routes.integration.test.ts`.
- `docs/stories/epics/E09-admin-crud/US-016-options-crud/{overview,validation}.md`, `docs/stories/backlog.md`.

---

### Task 1: `OptionGroupView` / `OptionView` + mappers

**Files:**
- Create: `src/application/option-groups/option-group-view.ts`
- Test: `test/option-groups/option-group-view.test.ts`

**Interfaces:**
- Produces:
  - `interface OptionView { id: string; optionGroupId: string; name: string; priceDelta: number }`
  - `interface OptionGroupView { id: string; menuItemId: string; name: string; type: 'SINGLE' | 'MULTI'; isRequired: boolean; options: OptionView[] }`
  - `toOptionView(row): OptionView`
  - `toOptionGroupView(group, optionRows): OptionGroupView`

- [ ] **Step 1: Write the failing test**

`test/option-groups/option-group-view.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'

import {
  toOptionGroupView,
  toOptionView,
} from '../../src/application/option-groups/option-group-view'

describe('toOptionView', () => {
  it('maps an option row to the admin-facing view', () => {
    expect(
      toOptionView({ id: 'opt-1', optionGroupId: 'grp-1', name: 'Large', priceDelta: 5000 }),
    ).toEqual({ id: 'opt-1', optionGroupId: 'grp-1', name: 'Large', priceDelta: 5000 })
  })

  it('preserves a negative priceDelta', () => {
    expect(
      toOptionView({ id: 'opt-2', optionGroupId: 'grp-1', name: 'Small', priceDelta: -5000 })
        .priceDelta,
    ).toBe(-5000)
  })
})

describe('toOptionGroupView', () => {
  it('maps a group plus its options, mapping each option through toOptionView', () => {
    const view = toOptionGroupView(
      { id: 'grp-1', menuItemId: 'item-1', name: 'Size', type: 'SINGLE', isRequired: true },
      [
        { id: 'opt-1', optionGroupId: 'grp-1', name: 'Large', priceDelta: 5000 },
        { id: 'opt-2', optionGroupId: 'grp-1', name: 'Small', priceDelta: 0 },
      ],
    )
    expect(view).toEqual({
      id: 'grp-1',
      menuItemId: 'item-1',
      name: 'Size',
      type: 'SINGLE',
      isRequired: true,
      options: [
        { id: 'opt-1', optionGroupId: 'grp-1', name: 'Large', priceDelta: 5000 },
        { id: 'opt-2', optionGroupId: 'grp-1', name: 'Small', priceDelta: 0 },
      ],
    })
  })

  it('yields an empty options array when the group has none', () => {
    const view = toOptionGroupView(
      { id: 'grp-2', menuItemId: 'item-1', name: 'Topping', type: 'MULTI', isRequired: false },
      [],
    )
    expect(view.options).toEqual([])
    expect(view.type).toBe('MULTI')
    expect(view.isRequired).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/option-groups/option-group-view.test.ts`
Expected: FAIL — cannot resolve `../../src/application/option-groups/option-group-view`.

- [ ] **Step 3: Write the implementation**

`src/application/option-groups/option-group-view.ts`:

```ts
/**
 * Admin-facing shapes for a dish's option tree (US-016). An `OptionGroupView` carries its
 * `menuItemId` (tenancy flows through the item → category → restaurant; the tables have no
 * `restaurantId`) and nests its options. Nothing here is sensitive. `priceDelta` may be negative
 * (e.g. a smaller size), so it is a plain signed integer added to the menu item price.
 */
export interface OptionView {
  id: string
  optionGroupId: string
  name: string
  priceDelta: number
}

export interface OptionGroupView {
  id: string
  menuItemId: string
  name: string
  type: 'SINGLE' | 'MULTI'
  isRequired: boolean
  options: OptionView[]
}

export function toOptionView(row: {
  id: string
  optionGroupId: string
  name: string
  priceDelta: number
}): OptionView {
  return {
    id: row.id,
    optionGroupId: row.optionGroupId,
    name: row.name,
    priceDelta: row.priceDelta,
  }
}

export function toOptionGroupView(
  group: {
    id: string
    menuItemId: string
    name: string
    type: 'SINGLE' | 'MULTI'
    isRequired: boolean
  },
  optionRows: Array<{ id: string; optionGroupId: string; name: string; priceDelta: number }>,
): OptionGroupView {
  return {
    id: group.id,
    menuItemId: group.menuItemId,
    name: group.name,
    type: group.type,
    isRequired: group.isRequired,
    options: optionRows.map(toOptionView),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/option-groups/option-group-view.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/option-groups/option-group-view.ts test/option-groups/option-group-view.test.ts
git commit -m "feat(us-016): option-group + option view mappers"
```

---

### Task 2: Error codes + `scope.ts` + `list-option-groups` + `create-option-group`

**Files:**
- Modify: `src/shared/errors/error-catalog.ts:49-53`
- Create: `src/application/option-groups/scope.ts`
- Create: `src/application/option-groups/list-option-groups.ts`
- Create: `src/application/option-groups/create-option-group.ts`
- Test: `test/option-groups/option-group-use-cases.test.ts`

**Interfaces:**
- Consumes: `OptionGroupView`, `toOptionGroupView` (Task 1); `pgErrorCode`, `AppError` from `../../shared/errors`; `categories`, `menuItems`, `optionGroups`, `options` from schema.
- Produces:
  - error codes `OPTION_GROUP_NOT_FOUND` (404), `OPTION_NOT_FOUND` (404).
  - `assertMenuItemInRestaurant(database, restaurantId: string, menuItemId: string): Promise<void>` (throws `MENU_ITEM_NOT_FOUND`).
  - `assertGroupInRestaurant(database, restaurantId: string, menuItemId: string, groupId: string): Promise<void>` (throws `MENU_ITEM_NOT_FOUND` then `OPTION_GROUP_NOT_FOUND`).
  - `listOptionGroupsUseCase(database, restaurantId: string, menuItemId: string): Promise<OptionGroupView[]>`
  - `interface CreateOptionGroupInput { name: string; type: 'SINGLE' | 'MULTI'; isRequired?: boolean }`
  - `createOptionGroupUseCase(database, restaurantId: string, menuItemId: string, input: CreateOptionGroupInput): Promise<OptionGroupView>`

- [ ] **Step 1: Add the two error codes**

In `src/shared/errors/error-catalog.ts`, right after the `MENU_ITEM_IN_USE` block (the `// Menu item administration (US-015)` section, currently lines 49–53), add:

```ts
  // Option groups & options administration (US-016)
  OPTION_GROUP_NOT_FOUND: { status: 404, message: 'Option group not found' },
  OPTION_NOT_FOUND: { status: 404, message: 'Option not found' },
```

- [ ] **Step 2: Write the failing test**

`test/option-groups/option-group-use-cases.test.ts`:

```ts
import { randomUUID } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { createOptionGroupUseCase } from '../../src/application/option-groups/create-option-group'
import { listOptionGroupsUseCase } from '../../src/application/option-groups/list-option-groups'
import { db } from '../../src/infrastructure/database/client'
import { categories, menuItems, restaurants } from '../../src/infrastructure/database/schema'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'

let schemaAvailable = false
let restaurantId = ''
let menuItemId = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const [r] = await db
    .insert(restaurants)
    .values({ name: `US-016 UC ${randomUUID()}` })
    .returning({ id: restaurants.id })
  restaurantId = r!.id
  const [c] = await db
    .insert(categories)
    .values({ restaurantId, name: 'Mains', sortOrder: 0 })
    .returning({ id: categories.id })
  const [item] = await db
    .insert(menuItems)
    .values({ categoryId: c!.id, name: 'Pho', price: 50000 })
    .returning({ id: menuItems.id })
  menuItemId = item!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable || !restaurantId) return
  const cats = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.restaurantId, restaurantId))
  const catIds = cats.map((c) => c.id)
  // deleting menu items cascades option_groups → options
  if (catIds.length) await db.delete(menuItems).where(inArray(menuItems.categoryId, catIds))
  await db.delete(categories).where(eq(categories.restaurantId, restaurantId))
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId))
}, DB_TIMEOUT_MS)

describe('createOptionGroupUseCase', () => {
  it(
    'defaults isRequired=false and returns an empty options array',
    async () => {
      if (!schemaAvailable) return
      const group = await createOptionGroupUseCase(db, restaurantId, menuItemId, {
        name: 'Topping',
        type: 'MULTI',
      })
      expect(group.name).toBe('Topping')
      expect(group.type).toBe('MULTI')
      expect(group.isRequired).toBe(false)
      expect(group.menuItemId).toBe(menuItemId)
      expect(group.options).toEqual([])
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws MENU_ITEM_NOT_FOUND when the menu item belongs to another restaurant',
    async () => {
      if (!schemaAvailable) return
      const [r2] = await db
        .insert(restaurants)
        .values({ name: `US-016 Other ${randomUUID()}` })
        .returning({ id: restaurants.id })
      const [c2] = await db
        .insert(categories)
        .values({ restaurantId: r2!.id, name: 'Foreign', sortOrder: 0 })
        .returning({ id: categories.id })
      const [foreignItem] = await db
        .insert(menuItems)
        .values({ categoryId: c2!.id, name: 'Theirs', price: 1000 })
        .returning({ id: menuItems.id })
      await expect(
        createOptionGroupUseCase(db, restaurantId, foreignItem!.id, {
          name: 'Sneaky',
          type: 'SINGLE',
        }),
      ).rejects.toMatchObject({ code: 'MENU_ITEM_NOT_FOUND' })
      await db.delete(menuItems).where(eq(menuItems.id, foreignItem!.id))
      await db.delete(categories).where(eq(categories.id, c2!.id))
      await db.delete(restaurants).where(eq(restaurants.id, r2!.id))
    },
    DB_TIMEOUT_MS,
  )
})

describe('listOptionGroupsUseCase', () => {
  it(
    'lists the item groups ordered by name, each with its options',
    async () => {
      if (!schemaAvailable) return
      const sizeGroup = await createOptionGroupUseCase(db, restaurantId, menuItemId, {
        name: 'Size',
        type: 'SINGLE',
        isRequired: true,
      })
      const groups = await listOptionGroupsUseCase(db, restaurantId, menuItemId)
      const names = groups.map((g) => g.name)
      // 'Size' sorts before 'Topping'
      expect(names.indexOf('Size')).toBeLessThan(names.indexOf('Topping'))
      const size = groups.find((g) => g.id === sizeGroup.id)
      expect(size).toBeDefined()
      expect(Array.isArray(size!.options)).toBe(true)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws MENU_ITEM_NOT_FOUND when listing groups of another restaurant item',
    async () => {
      if (!schemaAvailable) return
      const [r2] = await db
        .insert(restaurants)
        .values({ name: `US-016 Other ${randomUUID()}` })
        .returning({ id: restaurants.id })
      const [c2] = await db
        .insert(categories)
        .values({ restaurantId: r2!.id, name: 'Foreign', sortOrder: 0 })
        .returning({ id: categories.id })
      const [foreignItem] = await db
        .insert(menuItems)
        .values({ categoryId: c2!.id, name: 'Theirs', price: 1000 })
        .returning({ id: menuItems.id })
      await expect(
        listOptionGroupsUseCase(db, restaurantId, foreignItem!.id),
      ).rejects.toMatchObject({ code: 'MENU_ITEM_NOT_FOUND' })
      await db.delete(menuItems).where(eq(menuItems.id, foreignItem!.id))
      await db.delete(categories).where(eq(categories.id, c2!.id))
      await db.delete(restaurants).where(eq(restaurants.id, r2!.id))
    },
    DB_TIMEOUT_MS,
  )
})
```

(Nested-option content in the listing is proven end-to-end in Task 4, once the option create use-case exists; this Task 2 list test only asserts the group appears and its `options` is an array.)

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test test/option-groups/option-group-use-cases.test.ts`
Expected: FAIL — cannot resolve `create-option-group` / `list-option-groups`.

- [ ] **Step 4: Write the scope helper**

`src/application/option-groups/scope.ts`:

```ts
import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { categories, menuItems, optionGroups } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'

/**
 * Tenancy guards for the option tree (US-016). `option_groups`/`options` have no `restaurantId`, so
 * scope flows through `menu_item → category → restaurant`. These run as single autocommit reads
 * before each write so the check order (item → group) produces the precise 404, and a cross-tenant
 * id is indistinguishable from a missing one.
 */
export async function assertMenuItemInRestaurant(
  database: Database,
  restaurantId: string,
  menuItemId: string,
): Promise<void> {
  const [item] = await database
    .select({ id: menuItems.id })
    .from(menuItems)
    .innerJoin(categories, eq(categories.id, menuItems.categoryId))
    .where(and(eq(menuItems.id, menuItemId), eq(categories.restaurantId, restaurantId)))
    .limit(1)
  if (!item) throw new AppError('MENU_ITEM_NOT_FOUND')
}

export async function assertGroupInRestaurant(
  database: Database,
  restaurantId: string,
  menuItemId: string,
  groupId: string,
): Promise<void> {
  await assertMenuItemInRestaurant(database, restaurantId, menuItemId)
  const [group] = await database
    .select({ id: optionGroups.id })
    .from(optionGroups)
    .where(and(eq(optionGroups.id, groupId), eq(optionGroups.menuItemId, menuItemId)))
    .limit(1)
  if (!group) throw new AppError('OPTION_GROUP_NOT_FOUND')
}
```

- [ ] **Step 5: Implement `list-option-groups`**

`src/application/option-groups/list-option-groups.ts`:

```ts
import { asc, eq, inArray } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { optionGroups, options } from '../../infrastructure/database/schema'
import { type OptionGroupView, toOptionGroupView } from './option-group-view'
import { assertMenuItemInRestaurant } from './scope'

/**
 * List a menu item's option groups, each with its nested options (US-016). The item must belong to
 * the admin's restaurant (else `MENU_ITEM_NOT_FOUND`). Groups and options have no `sort_order`
 * column, so both are ordered by `name` for a deterministic result. Options are fetched in one
 * `inArray` query and grouped in memory to avoid an N+1.
 */
export async function listOptionGroupsUseCase(
  database: Database,
  restaurantId: string,
  menuItemId: string,
): Promise<OptionGroupView[]> {
  await assertMenuItemInRestaurant(database, restaurantId, menuItemId)

  const groups = await database
    .select()
    .from(optionGroups)
    .where(eq(optionGroups.menuItemId, menuItemId))
    .orderBy(asc(optionGroups.name))

  if (groups.length === 0) return []

  const groupIds = groups.map((g) => g.id)
  const optionRows = await database
    .select()
    .from(options)
    .where(inArray(options.optionGroupId, groupIds))
    .orderBy(asc(options.name))

  return groups.map((g) =>
    toOptionGroupView(
      g,
      optionRows.filter((o) => o.optionGroupId === g.id),
    ),
  )
}
```

- [ ] **Step 6: Implement `create-option-group`**

`src/application/option-groups/create-option-group.ts`:

```ts
import type { Database } from '../../infrastructure/database/client'
import { optionGroups } from '../../infrastructure/database/schema'
import { AppError, pgErrorCode } from '../../shared/errors'
import { type OptionGroupView, toOptionGroupView } from './option-group-view'
import { assertMenuItemInRestaurant } from './scope'

export interface CreateOptionGroupInput {
  name: string
  type: 'SINGLE' | 'MULTI'
  isRequired?: boolean
}

/**
 * Create an option group under one of the admin's menu items (US-016). The item must belong to
 * `restaurantId` — checked first and surfaced as `MENU_ITEM_NOT_FOUND` (404). SQLSTATE 23503 maps to
 * the same code as a backstop for the item being deleted between the check and the insert (Neon
 * transaction pooling). `isRequired` defaults false. A new group has no options yet.
 */
export async function createOptionGroupUseCase(
  database: Database,
  restaurantId: string,
  menuItemId: string,
  input: CreateOptionGroupInput,
): Promise<OptionGroupView> {
  await assertMenuItemInRestaurant(database, restaurantId, menuItemId)

  try {
    const [created] = await database
      .insert(optionGroups)
      .values({
        menuItemId,
        name: input.name,
        type: input.type,
        isRequired: input.isRequired ?? false,
      })
      .returning()
    return toOptionGroupView(created!, [])
  } catch (error) {
    if (pgErrorCode(error) === '23503') throw new AppError('MENU_ITEM_NOT_FOUND')
    throw error
  }
}
```

- [ ] **Step 7: Run tests + typecheck**

Run: `bun test test/option-groups/option-group-use-cases.test.ts`
Expected: PASS (or self-skip with no DB).

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/shared/errors/error-catalog.ts src/application/option-groups/scope.ts src/application/option-groups/list-option-groups.ts src/application/option-groups/create-option-group.ts test/option-groups/option-group-use-cases.test.ts
git commit -m "feat(us-016): error codes + scope guards + list/create option-group use-cases"
```

---

### Task 3: `update-option-group` + `delete-option-group`

**Files:**
- Create: `src/application/option-groups/update-option-group.ts`
- Create: `src/application/option-groups/delete-option-group.ts`
- Modify: `test/option-groups/option-group-use-cases.test.ts` (extend with update/delete suites)

**Interfaces:**
- Consumes: `OptionGroupView`, `toOptionGroupView`, `toOptionView`; `assertMenuItemInRestaurant`; `createOptionGroupUseCase`, `listOptionGroupsUseCase`; `AppError`; `optionGroups`, `options` from schema.
- Produces:
  - `interface UpdateOptionGroupInput { name?: string; type?: 'SINGLE' | 'MULTI'; isRequired?: boolean }`
  - `updateOptionGroupUseCase(database, restaurantId: string, menuItemId: string, groupId: string, input: UpdateOptionGroupInput): Promise<OptionGroupView>`
  - `deleteOptionGroupUseCase(database, restaurantId: string, menuItemId: string, groupId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests (append to the use-case suite)**

First extend the imports at the top of `test/option-groups/option-group-use-cases.test.ts`:

```ts
import { deleteOptionGroupUseCase } from '../../src/application/option-groups/delete-option-group'
import { updateOptionGroupUseCase } from '../../src/application/option-groups/update-option-group'
```

(Add alongside the existing `createOptionGroupUseCase` / `listOptionGroupsUseCase` imports — one import per module.)

Then append these suites at the end of the file:

```ts
describe('updateOptionGroupUseCase', () => {
  it(
    'patches only the fields provided',
    async () => {
      if (!schemaAvailable) return
      const group = await createOptionGroupUseCase(db, restaurantId, menuItemId, {
        name: 'Spice',
        type: 'SINGLE',
        isRequired: false,
      })
      const updated = await updateOptionGroupUseCase(db, restaurantId, menuItemId, group.id, {
        isRequired: true,
      })
      expect(updated.isRequired).toBe(true)
      expect(updated.name).toBe('Spice')
      expect(updated.type).toBe('SINGLE')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws OPTION_GROUP_NOT_FOUND for a group not under the named item',
    async () => {
      if (!schemaAvailable) return
      await expect(
        updateOptionGroupUseCase(db, restaurantId, menuItemId, randomUUID(), { name: 'X' }),
      ).rejects.toMatchObject({ code: 'OPTION_GROUP_NOT_FOUND' })
    },
    DB_TIMEOUT_MS,
  )
})

describe('deleteOptionGroupUseCase', () => {
  it(
    'deletes a group',
    async () => {
      if (!schemaAvailable) return
      const group = await createOptionGroupUseCase(db, restaurantId, menuItemId, {
        name: 'ToDelete',
        type: 'MULTI',
      })
      await deleteOptionGroupUseCase(db, restaurantId, menuItemId, group.id)
      const groups = await listOptionGroupsUseCase(db, restaurantId, menuItemId)
      expect(groups.some((g) => g.id === group.id)).toBe(false)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws OPTION_GROUP_NOT_FOUND for a missing group',
    async () => {
      if (!schemaAvailable) return
      await expect(
        deleteOptionGroupUseCase(db, restaurantId, menuItemId, randomUUID()),
      ).rejects.toMatchObject({ code: 'OPTION_GROUP_NOT_FOUND' })
    },
    DB_TIMEOUT_MS,
  )
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/option-groups/option-group-use-cases.test.ts`
Expected: FAIL — cannot resolve `update-option-group` / `delete-option-group`.

- [ ] **Step 3: Implement `update-option-group`**

`src/application/option-groups/update-option-group.ts`:

```ts
import { and, asc, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { optionGroups, options } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { type OptionGroupView, toOptionGroupView } from './option-group-view'
import { assertMenuItemInRestaurant } from './scope'

export interface UpdateOptionGroupInput {
  name?: string
  type?: 'SINGLE' | 'MULTI'
  isRequired?: boolean
}

/**
 * Update an option group (US-016). The named menu item must belong to `restaurantId` (else
 * `MENU_ITEM_NOT_FOUND`); the group must exist under that item (else `OPTION_GROUP_NOT_FOUND`).
 * Only the fields provided are patched. Returns the group with its current options. No FK references
 * `option_groups`, so no SQLSTATE backstop is needed.
 */
export async function updateOptionGroupUseCase(
  database: Database,
  restaurantId: string,
  menuItemId: string,
  groupId: string,
  input: UpdateOptionGroupInput,
): Promise<OptionGroupView> {
  await assertMenuItemInRestaurant(database, restaurantId, menuItemId)

  const patch: Partial<{ name: string; type: 'SINGLE' | 'MULTI'; isRequired: boolean }> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.type !== undefined) patch.type = input.type
  if (input.isRequired !== undefined) patch.isRequired = input.isRequired

  const scope = and(eq(optionGroups.id, groupId), eq(optionGroups.menuItemId, menuItemId))

  let group
  if (Object.keys(patch).length === 0) {
    ;[group] = await database.select().from(optionGroups).where(scope).limit(1)
  } else {
    ;[group] = await database.update(optionGroups).set(patch).where(scope).returning()
  }
  if (!group) throw new AppError('OPTION_GROUP_NOT_FOUND')

  const optionRows = await database
    .select()
    .from(options)
    .where(eq(options.optionGroupId, groupId))
    .orderBy(asc(options.name))

  return toOptionGroupView(group, optionRows)
}
```

- [ ] **Step 4: Implement `delete-option-group`**

`src/application/option-groups/delete-option-group.ts`:

```ts
import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { optionGroups } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { assertMenuItemInRestaurant } from './scope'

/**
 * Delete an option group (US-016). The named menu item must belong to `restaurantId` (else
 * `MENU_ITEM_NOT_FOUND`); the group must exist under that item (else `OPTION_GROUP_NOT_FOUND`). The
 * group's `options` cascade away with it (`onDelete: 'cascade'`). Order history is never affected —
 * `order_item_options` snapshots option data with no FK back to `options`/`option_groups` — so the
 * delete is always safe (no in-use guard, no SQLSTATE backstop).
 */
export async function deleteOptionGroupUseCase(
  database: Database,
  restaurantId: string,
  menuItemId: string,
  groupId: string,
): Promise<void> {
  await assertMenuItemInRestaurant(database, restaurantId, menuItemId)

  const scope = and(eq(optionGroups.id, groupId), eq(optionGroups.menuItemId, menuItemId))
  const [existing] = await database
    .select({ id: optionGroups.id })
    .from(optionGroups)
    .where(scope)
    .limit(1)
  if (!existing) throw new AppError('OPTION_GROUP_NOT_FOUND')

  await database.delete(optionGroups).where(scope)
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test test/option-groups/option-group-use-cases.test.ts`
Expected: PASS (or self-skip with no DB).

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/application/option-groups/update-option-group.ts src/application/option-groups/delete-option-group.ts test/option-groups/option-group-use-cases.test.ts
git commit -m "feat(us-016): update + delete option-group use-cases (cascade options)"
```

---

### Task 4: `create-option` + `update-option` + `delete-option`

**Files:**
- Create: `src/application/option-groups/create-option.ts`
- Create: `src/application/option-groups/update-option.ts`
- Create: `src/application/option-groups/delete-option.ts`
- Modify: `test/option-groups/option-group-use-cases.test.ts` (extend with option suites)

**Interfaces:**
- Consumes: `OptionView`, `toOptionView`; `assertGroupInRestaurant`; `AppError`, `pgErrorCode`; `options` from schema.
- Produces:
  - `interface CreateOptionInput { name: string; priceDelta?: number }`
  - `createOptionUseCase(database, restaurantId: string, menuItemId: string, groupId: string, input: CreateOptionInput): Promise<OptionView>`
  - `interface UpdateOptionInput { name?: string; priceDelta?: number }`
  - `updateOptionUseCase(database, restaurantId: string, menuItemId: string, groupId: string, optionId: string, input: UpdateOptionInput): Promise<OptionView>`
  - `deleteOptionUseCase(database, restaurantId: string, menuItemId: string, groupId: string, optionId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests (append to the use-case suite)**

First extend the imports at the top of `test/option-groups/option-group-use-cases.test.ts`:

```ts
import { createOptionUseCase } from '../../src/application/option-groups/create-option'
import { deleteOptionUseCase } from '../../src/application/option-groups/delete-option'
import { updateOptionUseCase } from '../../src/application/option-groups/update-option'
```

Then append these suites at the end of the file:

```ts
describe('option CRUD use-cases', () => {
  it(
    'creates an option (priceDelta defaults to 0) and surfaces it in the group listing',
    async () => {
      if (!schemaAvailable) return
      const group = await createOptionGroupUseCase(db, restaurantId, menuItemId, {
        name: 'Extras',
        type: 'MULTI',
      })
      const created = await createOptionUseCase(db, restaurantId, menuItemId, group.id, {
        name: 'Egg',
      })
      expect(created.name).toBe('Egg')
      expect(created.priceDelta).toBe(0)
      expect(created.optionGroupId).toBe(group.id)

      const groups = await listOptionGroupsUseCase(db, restaurantId, menuItemId)
      const listed = groups.find((g) => g.id === group.id)
      expect(listed!.options.some((o) => o.id === created.id)).toBe(true)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'persists a negative priceDelta and patches only the fields provided',
    async () => {
      if (!schemaAvailable) return
      const group = await createOptionGroupUseCase(db, restaurantId, menuItemId, {
        name: 'Sizing',
        type: 'SINGLE',
      })
      const created = await createOptionUseCase(db, restaurantId, menuItemId, group.id, {
        name: 'Small',
        priceDelta: -5000,
      })
      expect(created.priceDelta).toBe(-5000)
      const updated = await updateOptionUseCase(db, restaurantId, menuItemId, group.id, created.id, {
        name: 'Tiny',
      })
      expect(updated.name).toBe('Tiny')
      expect(updated.priceDelta).toBe(-5000)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'deletes an option',
    async () => {
      if (!schemaAvailable) return
      const group = await createOptionGroupUseCase(db, restaurantId, menuItemId, {
        name: 'Removable',
        type: 'MULTI',
      })
      const created = await createOptionUseCase(db, restaurantId, menuItemId, group.id, {
        name: 'Gone',
      })
      await deleteOptionUseCase(db, restaurantId, menuItemId, group.id, created.id)
      const groups = await listOptionGroupsUseCase(db, restaurantId, menuItemId)
      const listed = groups.find((g) => g.id === group.id)
      expect(listed!.options.some((o) => o.id === created.id)).toBe(false)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws OPTION_GROUP_NOT_FOUND creating an option under a missing group',
    async () => {
      if (!schemaAvailable) return
      await expect(
        createOptionUseCase(db, restaurantId, menuItemId, randomUUID(), { name: 'Orphan' }),
      ).rejects.toMatchObject({ code: 'OPTION_GROUP_NOT_FOUND' })
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws OPTION_NOT_FOUND updating a missing option in a real group',
    async () => {
      if (!schemaAvailable) return
      const group = await createOptionGroupUseCase(db, restaurantId, menuItemId, {
        name: 'Real',
        type: 'SINGLE',
      })
      await expect(
        updateOptionUseCase(db, restaurantId, menuItemId, group.id, randomUUID(), { name: 'X' }),
      ).rejects.toMatchObject({ code: 'OPTION_NOT_FOUND' })
    },
    DB_TIMEOUT_MS,
  )
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/option-groups/option-group-use-cases.test.ts`
Expected: FAIL — cannot resolve `create-option` / `update-option` / `delete-option`.

- [ ] **Step 3: Implement `create-option`**

`src/application/option-groups/create-option.ts`:

```ts
import type { Database } from '../../infrastructure/database/client'
import { options } from '../../infrastructure/database/schema'
import { AppError, pgErrorCode } from '../../shared/errors'
import { type OptionView, toOptionView } from './option-group-view'
import { assertGroupInRestaurant } from './scope'

export interface CreateOptionInput {
  name: string
  priceDelta?: number
}

/**
 * Create an option under a group (US-016). The named menu item must belong to `restaurantId` (else
 * `MENU_ITEM_NOT_FOUND`) and the group must exist under it (else `OPTION_GROUP_NOT_FOUND`). SQLSTATE
 * 23503 maps to `OPTION_GROUP_NOT_FOUND` as a backstop for the group being deleted between the check
 * and the insert (Neon transaction pooling). `priceDelta` defaults to 0 and may be negative.
 */
export async function createOptionUseCase(
  database: Database,
  restaurantId: string,
  menuItemId: string,
  groupId: string,
  input: CreateOptionInput,
): Promise<OptionView> {
  await assertGroupInRestaurant(database, restaurantId, menuItemId, groupId)

  try {
    const [created] = await database
      .insert(options)
      .values({ optionGroupId: groupId, name: input.name, priceDelta: input.priceDelta ?? 0 })
      .returning()
    return toOptionView(created!)
  } catch (error) {
    if (pgErrorCode(error) === '23503') throw new AppError('OPTION_GROUP_NOT_FOUND')
    throw error
  }
}
```

- [ ] **Step 4: Implement `update-option`**

`src/application/option-groups/update-option.ts`:

```ts
import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { options } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { type OptionView, toOptionView } from './option-group-view'
import { assertGroupInRestaurant } from './scope'

export interface UpdateOptionInput {
  name?: string
  priceDelta?: number
}

/**
 * Update an option (US-016). The named menu item must belong to `restaurantId` (else
 * `MENU_ITEM_NOT_FOUND`), the group must exist under it (else `OPTION_GROUP_NOT_FOUND`), and the
 * option must exist under that group (else `OPTION_NOT_FOUND`). Only the fields provided are
 * patched. `priceDelta` may be negative.
 */
export async function updateOptionUseCase(
  database: Database,
  restaurantId: string,
  menuItemId: string,
  groupId: string,
  optionId: string,
  input: UpdateOptionInput,
): Promise<OptionView> {
  await assertGroupInRestaurant(database, restaurantId, menuItemId, groupId)

  const patch: Partial<{ name: string; priceDelta: number }> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.priceDelta !== undefined) patch.priceDelta = input.priceDelta

  const scope = and(eq(options.id, optionId), eq(options.optionGroupId, groupId))

  let option
  if (Object.keys(patch).length === 0) {
    ;[option] = await database.select().from(options).where(scope).limit(1)
  } else {
    ;[option] = await database.update(options).set(patch).where(scope).returning()
  }
  if (!option) throw new AppError('OPTION_NOT_FOUND')

  return toOptionView(option)
}
```

- [ ] **Step 5: Implement `delete-option`**

`src/application/option-groups/delete-option.ts`:

```ts
import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { options } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'
import { assertGroupInRestaurant } from './scope'

/**
 * Delete an option (US-016). The named menu item must belong to `restaurantId` (else
 * `MENU_ITEM_NOT_FOUND`), the group must exist under it (else `OPTION_GROUP_NOT_FOUND`), and the
 * option must exist under that group (else `OPTION_NOT_FOUND`). Order history is never affected
 * (`order_item_options` has no FK back to `options`), so the delete is always safe.
 */
export async function deleteOptionUseCase(
  database: Database,
  restaurantId: string,
  menuItemId: string,
  groupId: string,
  optionId: string,
): Promise<void> {
  await assertGroupInRestaurant(database, restaurantId, menuItemId, groupId)

  const scope = and(eq(options.id, optionId), eq(options.optionGroupId, groupId))
  const [existing] = await database
    .select({ id: options.id })
    .from(options)
    .where(scope)
    .limit(1)
  if (!existing) throw new AppError('OPTION_NOT_FOUND')

  await database.delete(options).where(scope)
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `bun test test/option-groups/option-group-use-cases.test.ts`
Expected: PASS (or self-skip with no DB).

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/application/option-groups/create-option.ts src/application/option-groups/update-option.ts src/application/option-groups/delete-option.ts test/option-groups/option-group-use-cases.test.ts
git commit -m "feat(us-016): create + update + delete option use-cases"
```

---

### Task 5: HTTP route + mount + integration tests

**Files:**
- Create: `src/presentation/http/routes/option-groups.ts`
- Modify: `src/presentation/http/app.ts:9-27`
- Test: `test/option-groups/option-groups-routes.integration.test.ts`

**Interfaces:**
- Consumes: all seven use-cases from `src/application/option-groups/`; `db`; `authGuard`.
- Produces: `optionGroupsRoutes` (Elysia plugin, prefix `/menu-items`), mounted in `app`.

- [ ] **Step 1: Write the failing integration test**

`test/option-groups/option-groups-routes.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { hashPassword } from '../../src/infrastructure/auth/password'
import { db } from '../../src/infrastructure/database/client'
import {
  categories,
  menuItems,
  optionGroups,
  restaurants,
  users,
} from '../../src/infrastructure/database/schema'
import { app } from '../../src/presentation/http/app'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'
import { errorCode } from '../support/http'

let schemaAvailable = false
const password = 'admin-pw-us016'
const adminAEmail = `admin-a-${randomUUID()}@us016.test`
const adminBEmail = `admin-b-${randomUUID()}@us016.test`
const cashierAEmail = `cashier-a-${randomUUID()}@us016.test`
let restaurantAId = ''
let restaurantBId = ''
let itemAId = ''
let itemBId = ''
let groupBId = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const passwordHash = await hashPassword(password)
  const [a] = await db.insert(restaurants).values({ name: 'US-016 A' }).returning({ id: restaurants.id })
  restaurantAId = a!.id
  const [b] = await db.insert(restaurants).values({ name: 'US-016 B' }).returning({ id: restaurants.id })
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
  const [catB] = await db
    .insert(categories)
    .values({ restaurantId: restaurantBId, name: 'B Mains', sortOrder: 0 })
    .returning({ id: categories.id })
  const [itemA] = await db
    .insert(menuItems)
    .values({ categoryId: catA!.id, name: 'A Dish', price: 50000 })
    .returning({ id: menuItems.id })
  itemAId = itemA!.id
  const [itemB] = await db
    .insert(menuItems)
    .values({ categoryId: catB!.id, name: 'B Dish', price: 50000 })
    .returning({ id: menuItems.id })
  itemBId = itemB!.id
  const [groupB] = await db
    .insert(optionGroups)
    .values({ menuItemId: itemBId, name: 'B Size', type: 'SINGLE', isRequired: false })
    .returning({ id: optionGroups.id })
  groupBId = groupB!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable) return
  for (const rid of [restaurantAId, restaurantBId].filter(Boolean)) {
    const cats = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.restaurantId, rid))
    const catIds = cats.map((c) => c.id)
    // deleting menu items cascades option_groups → options
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

describe('option-groups + options CRUD', () => {
  it(
    'rejects a non-admin with 403 and a missing token with 401',
    async () => {
      if (!schemaAvailable) return
      const cashier = await tokenFor(cashierAEmail)
      expect((await req(`/menu-items/${itemAId}/option-groups`, { token: cashier })).status).toBe(403)
      expect((await req(`/menu-items/${itemAId}/option-groups`)).status).toBe(401)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'runs the full nested CRUD lifecycle scoped to the admin restaurant',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)

      // create group
      const createdGroup = await req(`/menu-items/${itemAId}/option-groups`, {
        method: 'POST',
        token,
        body: { name: 'Size', type: 'SINGLE', isRequired: true },
      })
      expect(createdGroup.status).toBe(201)
      const { data: g } = (await createdGroup.json()) as {
        data: { optionGroup: { id: string; isRequired: boolean; options: unknown[] } }
      }
      expect(g.optionGroup.isRequired).toBe(true)
      expect(g.optionGroup.options).toEqual([])
      const groupId = g.optionGroup.id

      // create option (priceDelta defaults 0)
      const createdOption = await req(`/menu-items/${itemAId}/option-groups/${groupId}/options`, {
        method: 'POST',
        token,
        body: { name: 'Large', priceDelta: 5000 },
      })
      expect(createdOption.status).toBe(201)
      const { data: o } = (await createdOption.json()) as {
        data: { option: { id: string; priceDelta: number } }
      }
      expect(o.option.priceDelta).toBe(5000)
      const optionId = o.option.id

      // list shows the group with its nested option
      const listed = await req(`/menu-items/${itemAId}/option-groups`, { token })
      expect(listed.status).toBe(200)
      const { data: l } = (await listed.json()) as {
        data: { optionGroups: Array<{ id: string; options: Array<{ id: string }> }> }
      }
      const found = l.optionGroups.find((x) => x.id === groupId)
      expect(found!.options.some((x) => x.id === optionId)).toBe(true)

      // patch group + option
      const patchedGroup = await req(`/menu-items/${itemAId}/option-groups/${groupId}`, {
        method: 'PATCH',
        token,
        body: { isRequired: false },
      })
      expect(patchedGroup.status).toBe(200)
      const patchedOption = await req(
        `/menu-items/${itemAId}/option-groups/${groupId}/options/${optionId}`,
        { method: 'PATCH', token, body: { priceDelta: -1000 } },
      )
      expect(patchedOption.status).toBe(200)
      const { data: po } = (await patchedOption.json()) as { data: { option: { priceDelta: number } } }
      expect(po.option.priceDelta).toBe(-1000)

      // delete option, then delete group
      expect(
        (
          await req(`/menu-items/${itemAId}/option-groups/${groupId}/options/${optionId}`, {
            method: 'DELETE',
            token,
          })
        ).status,
      ).toBe(204)
      expect(
        (await req(`/menu-items/${itemAId}/option-groups/${groupId}`, { method: 'DELETE', token }))
          .status,
      ).toBe(204)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects a group with an invalid type with 400',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const res = await req(`/menu-items/${itemAId}/option-groups`, {
        method: 'POST',
        token,
        body: { name: 'Bad', type: 'TRIPLE' },
      })
      expect(res.status).toBe(400)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'cannot create a group under another restaurant item — 404 MENU_ITEM_NOT_FOUND',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      const res = await req(`/menu-items/${itemBId}/option-groups`, {
        method: 'POST',
        token,
        body: { name: 'Sneaky', type: 'SINGLE' },
      })
      expect(res.status).toBe(404)
      expect(await errorCode(res)).toBe('MENU_ITEM_NOT_FOUND')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'cannot touch another restaurant group — 404 OPTION_GROUP_NOT_FOUND',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminAEmail)
      // admin A names their own item but B's groupId → group not under item A → OPTION_GROUP_NOT_FOUND
      const res = await req(`/menu-items/${itemAId}/option-groups/${groupBId}`, {
        method: 'PATCH',
        token,
        body: { name: 'Hijack' },
      })
      expect(res.status).toBe(404)
      expect(await errorCode(res)).toBe('OPTION_GROUP_NOT_FOUND')
    },
    DB_TIMEOUT_MS,
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/option-groups/option-groups-routes.integration.test.ts`
Expected: FAIL — `optionGroupsRoutes` not mounted / routes 404 (or self-skip with no DB).

- [ ] **Step 3: Implement the route**

`src/presentation/http/routes/option-groups.ts`:

```ts
import { Elysia, t } from 'elysia'

import { createOptionUseCase } from '../../../application/option-groups/create-option'
import { createOptionGroupUseCase } from '../../../application/option-groups/create-option-group'
import { deleteOptionUseCase } from '../../../application/option-groups/delete-option'
import { deleteOptionGroupUseCase } from '../../../application/option-groups/delete-option-group'
import { listOptionGroupsUseCase } from '../../../application/option-groups/list-option-groups'
import { updateOptionUseCase } from '../../../application/option-groups/update-option'
import { updateOptionGroupUseCase } from '../../../application/option-groups/update-option-group'
import { db } from '../../../infrastructure/database/client'
import { authGuard } from '../plugins/auth-guard'

const groupType = t.Union([t.Literal('SINGLE'), t.Literal('MULTI')])

const optionView = t.Object({
  id: t.String({ format: 'uuid' }),
  optionGroupId: t.String({ format: 'uuid' }),
  name: t.String(),
  priceDelta: t.Integer(),
})

const optionGroupView = t.Object({
  id: t.String({ format: 'uuid' }),
  menuItemId: t.String({ format: 'uuid' }),
  name: t.String(),
  type: groupType,
  isRequired: t.Boolean(),
  options: t.Array(optionView),
})

const createGroupBody = t.Object({
  name: t.String({ minLength: 1 }),
  type: groupType,
  isRequired: t.Optional(t.Boolean()),
})

const updateGroupBody = t.Object(
  {
    name: t.Optional(t.String({ minLength: 1 })),
    type: t.Optional(groupType),
    isRequired: t.Optional(t.Boolean()),
  },
  { minProperties: 1 },
)

const createOptionBody = t.Object({
  name: t.String({ minLength: 1 }),
  priceDelta: t.Optional(t.Integer()),
})

const updateOptionBody = t.Object(
  {
    name: t.Optional(t.String({ minLength: 1 })),
    priceDelta: t.Optional(t.Integer()),
  },
  { minProperties: 1 },
)

const menuItemParams = t.Object({ menuItemId: t.String({ format: 'uuid' }) })
const groupParams = t.Object({
  menuItemId: t.String({ format: 'uuid' }),
  groupId: t.String({ format: 'uuid' }),
})
const optionParams = t.Object({
  menuItemId: t.String({ format: 'uuid' }),
  groupId: t.String({ format: 'uuid' }),
  optionId: t.String({ format: 'uuid' }),
})

/**
 * Admin option-group + option administration (US-016), nested under a menu item. Every route is
 * guarded by `ADMIN` and tenant-scoped: `option_groups`/`options` have no `restaurantId`, so tenancy
 * flows through `menu_item → category → restaurant`, and the restaurant always comes from
 * `auth.restaurantId`, never the request body/params. Shares the `/menu-items` prefix with the
 * US-015 menu-items route (the two register at different path depths and do not collide).
 *
 * See docs/product/menu.md (US-6.3).
 */
export const optionGroupsRoutes = new Elysia({ prefix: '/menu-items' })
  .use(authGuard)
  .guard({ auth: ['ADMIN'] })
  .get(
    '/:menuItemId/option-groups',
    async ({ auth, params }) => {
      const optionGroups = await listOptionGroupsUseCase(db, auth.restaurantId, params.menuItemId)
      return { data: { optionGroups } }
    },
    {
      params: menuItemParams,
      detail: { tags: ['Option Groups'], summary: 'List a menu item option groups + options' },
      response: { 200: t.Object({ data: t.Object({ optionGroups: t.Array(optionGroupView) }) }) },
    },
  )
  .post(
    '/:menuItemId/option-groups',
    async ({ auth, params, body, set }) => {
      const optionGroup = await createOptionGroupUseCase(
        db,
        auth.restaurantId,
        params.menuItemId,
        body,
      )
      set.status = 201
      return { data: { optionGroup } }
    },
    {
      params: menuItemParams,
      body: createGroupBody,
      detail: { tags: ['Option Groups'], summary: 'Create an option group' },
      response: { 201: t.Object({ data: t.Object({ optionGroup: optionGroupView }) }) },
    },
  )
  .patch(
    '/:menuItemId/option-groups/:groupId',
    async ({ auth, params, body }) => {
      const optionGroup = await updateOptionGroupUseCase(
        db,
        auth.restaurantId,
        params.menuItemId,
        params.groupId,
        body,
      )
      return { data: { optionGroup } }
    },
    {
      params: groupParams,
      body: updateGroupBody,
      detail: { tags: ['Option Groups'], summary: 'Update an option group' },
      response: { 200: t.Object({ data: t.Object({ optionGroup: optionGroupView }) }) },
    },
  )
  .delete(
    '/:menuItemId/option-groups/:groupId',
    async ({ auth, params, set }) => {
      await deleteOptionGroupUseCase(db, auth.restaurantId, params.menuItemId, params.groupId)
      set.status = 204
    },
    {
      params: groupParams,
      detail: { tags: ['Option Groups'], summary: 'Delete an option group (cascades its options)' },
      response: { 204: t.Void() },
    },
  )
  .post(
    '/:menuItemId/option-groups/:groupId/options',
    async ({ auth, params, body, set }) => {
      const option = await createOptionUseCase(
        db,
        auth.restaurantId,
        params.menuItemId,
        params.groupId,
        body,
      )
      set.status = 201
      return { data: { option } }
    },
    {
      params: groupParams,
      body: createOptionBody,
      detail: { tags: ['Option Groups'], summary: 'Create an option' },
      response: { 201: t.Object({ data: t.Object({ option: optionView }) }) },
    },
  )
  .patch(
    '/:menuItemId/option-groups/:groupId/options/:optionId',
    async ({ auth, params, body }) => {
      const option = await updateOptionUseCase(
        db,
        auth.restaurantId,
        params.menuItemId,
        params.groupId,
        params.optionId,
        body,
      )
      return { data: { option } }
    },
    {
      params: optionParams,
      body: updateOptionBody,
      detail: { tags: ['Option Groups'], summary: 'Update an option' },
      response: { 200: t.Object({ data: t.Object({ option: optionView }) }) },
    },
  )
  .delete(
    '/:menuItemId/option-groups/:groupId/options/:optionId',
    async ({ auth, params, set }) => {
      await deleteOptionUseCase(
        db,
        auth.restaurantId,
        params.menuItemId,
        params.groupId,
        params.optionId,
      )
      set.status = 204
    },
    {
      params: optionParams,
      detail: { tags: ['Option Groups'], summary: 'Delete an option' },
      response: { 204: t.Void() },
    },
  )
```

- [ ] **Step 4: Mount the route in `app.ts`**

In `src/presentation/http/app.ts`, add the import next to the other route imports (after the `menuItemsRoutes` import line):

```ts
import { optionGroupsRoutes } from './routes/option-groups'
```

And add `.use(optionGroupsRoutes)` to the chain, right after `.use(menuItemsRoutes)`:

```ts
  .use(menuItemsRoutes)
  .use(optionGroupsRoutes)
  .use(kitchenRoutes)
```

- [ ] **Step 5: Run tests + typecheck + lint**

Run: `bun test test/option-groups`
Expected: PASS (or self-skip with no DB).

Run: `bun run typecheck`
Expected: clean.

Run: `bun run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/presentation/http/routes/option-groups.ts src/presentation/http/app.ts test/option-groups/option-groups-routes.integration.test.ts
git commit -m "feat(us-016): option-groups + options CRUD route + mount"
```

---

### Task 6: Validation record + backlog status

> The story overview (`overview.md`) and the backlog `in_progress` entry were sliced **up front**
> (commit `docs(e09): slice US-016 options CRUD story packet`), matching the US-014 convention. This
> task closes the packet out: the validation record at the end + flipping the backlog to done.

**Files:**
- Create: `docs/stories/epics/E09-admin-crud/US-016-options-crud/validation.md`
- Modify: `docs/stories/backlog.md:23`

**Interfaces:** none (docs only).

- [ ] **Step 1: Write the validation record**

Create `docs/stories/epics/E09-admin-crud/US-016-options-crud/validation.md`, mirroring `docs/stories/epics/E09-admin-crud/US-015-menu-items-crud/validation.md`: a Proof Status section with the `harness-cli story update` line for US-016 (`--unit 1 --integration 1 --e2e 0 --platform 0`), a Layer → Proof table, and an Evidence section. Fill the evidence from the final `bun test` run (record the exact pass/fail counts and the option-groups suite counts) and note DB-suite self-skip behavior.

- [ ] **Step 2: Update the backlog status to done**

In `docs/stories/backlog.md`, line 23, update the E09 row Status. Change:

```
| E09 Admin CRUD | US-014 categories, US-015 menu-items, US-016 options, US-017 tables + QR | slicing (US-014, US-015 done; US-016 in_progress) |
```

to:

```
| E09 Admin CRUD | US-014 categories, US-015 menu-items, US-016 options, US-017 tables + QR | slicing (US-014, US-015, US-016 done; US-017 next) |
```

- [ ] **Step 3: Run the full suite for the validation evidence**

Run: `bun test 2>&1 | tail -15`
Expected: all pass (or DB suites self-skip if no DB) — record the counts into `validation.md`.

Run: `bun run typecheck && bun run lint`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add docs/stories docs/superpowers/plans
git commit -m "docs(us-016): validation record + backlog status"
```

---

## Self-Review

**1. Spec coverage:**
- Nested CRUD surface (Option A: groups under item, options under group) → Task 5 route with all 7 endpoints. ✓
- GET list groups + nested options → Task 2 `listOptionGroupsUseCase` + Task 5 GET. ✓
- POST/PATCH/DELETE group → Tasks 2/3 use-cases + Task 5 routes. ✓
- POST/PATCH/DELETE option → Task 4 use-cases + Task 5 routes. ✓
- Field rules: group `name` minLength 1, `type` enum required, `isRequired` default false; option `name` minLength 1, `priceDelta` default 0, **negative allowed** (no `minimum`), update `minProperties: 1` → Task 5 schemas + Tasks 2/3/4 defaults; negative `priceDelta` proven in Task 4 test. ✓
- Tenancy one join deeper, restaurant from `auth.restaurantId`, check order item→group→option → Task 2 `scope.ts` (`assertMenuItemInRestaurant`, `assertGroupInRestaurant`), consumed by every use-case. ✓
- Cross-tenant/missing → correct 404 codes → Tasks 2/3/4 unit tests + Task 5 integration (`MENU_ITEM_NOT_FOUND`, `OPTION_GROUP_NOT_FOUND`). ✓
- No in-use guard; deletes always safe; cascade group→options → Task 3 delete-group (cascade asserted by list-after-delete), Task 4 delete-option; comments document the no-FK rationale. ✓
- New errors `OPTION_GROUP_NOT_FOUND`, `OPTION_NOT_FOUND`; reuse `MENU_ITEM_NOT_FOUND` → Task 2 Step 1. ✓
- RBAC ADMIN-only (401/403) → Task 5 test. ✓
- No migration → confirmed; not in any task. ✓
- Ordering by `name` (no `sort_order` column) → Task 2 list query `orderBy(asc(name))`. ✓

**2. Placeholder scan:** No TBD/TODO and no stray lines in implementation steps. Task 6 steps 1–2 reference the already-written US-015 docs + design spec as the structural template rather than repeating prose — acceptable for a docs task. Every code step shows full code.

**3. Type consistency:** `OptionGroupView` / `OptionView` field names identical across the view module, all seven use-cases, and the route's `optionGroupView` / `optionView` t.Objects. Use-case signatures match their Interfaces blocks and the route call sites: `listOptionGroupsUseCase(db, restaurantId, menuItemId)`, `createOptionGroupUseCase(db, restaurantId, menuItemId, body)`, `updateOptionGroupUseCase(db, restaurantId, menuItemId, groupId, body)`, `deleteOptionGroupUseCase(db, restaurantId, menuItemId, groupId)`, `createOptionUseCase(db, restaurantId, menuItemId, groupId, body)`, `updateOptionUseCase(db, restaurantId, menuItemId, groupId, optionId, body)`, `deleteOptionUseCase(db, restaurantId, menuItemId, groupId, optionId)`. Response keys: `{ data: { optionGroups } }` (list), `{ data: { optionGroup } }` (group create/update), `{ data: { option } }` (option create/update) — consistent between Task 5 route and the integration test. `assertMenuItemInRestaurant` / `assertGroupInRestaurant` names match across `scope.ts` and all consumers. ✓
```
