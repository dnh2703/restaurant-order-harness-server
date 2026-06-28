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
