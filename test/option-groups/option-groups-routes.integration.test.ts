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
  const [a] = await db
    .insert(restaurants)
    .values({ name: 'US-016 A' })
    .returning({ id: restaurants.id })
  restaurantAId = a!.id
  const [b] = await db
    .insert(restaurants)
    .values({ name: 'US-016 B' })
    .returning({ id: restaurants.id })
  restaurantBId = b!.id
  await db.insert(users).values([
    {
      restaurantId: restaurantAId,
      email: adminAEmail,
      passwordHash,
      name: 'Admin A',
      role: 'ADMIN',
    },
    {
      restaurantId: restaurantAId,
      email: cashierAEmail,
      passwordHash,
      name: 'Cashier A',
      role: 'CASHIER',
    },
    {
      restaurantId: restaurantBId,
      email: adminBEmail,
      passwordHash,
      name: 'Admin B',
      role: 'ADMIN',
    },
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
      expect((await req(`/menu-items/${itemAId}/option-groups`, { token: cashier })).status).toBe(
        403,
      )
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
      const { data: po } = (await patchedOption.json()) as {
        data: { option: { priceDelta: number } }
      }
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
