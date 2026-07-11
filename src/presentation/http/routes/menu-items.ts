import { Elysia, t } from 'elysia'

import { createMenuItemUseCase } from '../../../application/menu-items/create-menu-item'
import { deleteMenuItemUseCase } from '../../../application/menu-items/delete-menu-item'
import { listMenuItemsUseCase } from '../../../application/menu-items/list-menu-items'
import { updateMenuItemUseCase } from '../../../application/menu-items/update-menu-item'
import { uploadDishImageUseCase } from '../../../application/menu-items/upload-dish-image'
import { db } from '../../../infrastructure/database/client'
import { dishImageStorage } from '../../../infrastructure/storage/dish-image-storage'
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

// US-026: an absolute http(s) URL, or null/absent. `format: 'uri'` alone accepts any URI
// scheme (including `javascript:`), so the pattern additionally pins it to http(s).
const imageUrlBody = t.Optional(
  t.Union([t.String({ format: 'uri', pattern: '^https?://' }), t.Null()]),
)

const createBody = t.Object({
  categoryId: t.String({ format: 'uuid' }),
  name: t.String({ minLength: 1 }),
  price: t.Integer({ minimum: 0 }),
  description: t.Optional(t.Union([t.String(), t.Null()])),
  imageUrl: imageUrlBody,
  isAvailable: t.Optional(t.Boolean()),
  sortOrder: t.Optional(t.Integer()),
})

const updateBody = t.Object(
  {
    categoryId: t.Optional(t.String({ format: 'uuid' })),
    name: t.Optional(t.String({ minLength: 1 })),
    price: t.Optional(t.Integer({ minimum: 0 })),
    description: t.Optional(t.Union([t.String(), t.Null()])),
    imageUrl: imageUrlBody,
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
  .post(
    '/image',
    async ({ auth, body, set }) => {
      const result = await uploadDishImageUseCase(dishImageStorage(), auth.restaurantId, body.file)
      set.status = 201
      return { data: { url: result.url } }
    },
    {
      // Permissive file field: the use case owns type/size validation so it can return the
      // specific IMAGE_* codes (a constrained t.File would pre-empt them with VALIDATION_ERROR).
      body: t.Object({ file: t.Optional(t.File()) }),
      detail: { tags: ['Menu Items'], summary: 'Upload a dish image, returns its public URL' },
      response: {
        201: t.Object({ data: t.Object({ url: t.String() }) }),
      },
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
