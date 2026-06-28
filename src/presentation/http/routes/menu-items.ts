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
