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

// Use `:id` for the menuItemId segment to match the parameter name already registered by the
// US-015 menuItemsRoutes (`PATCH /menu-items/:id`, `DELETE /menu-items/:id`). Both plugins share
// the same `/menu-items` prefix and are merged into the same memoirist router trie, which requires
// all dynamic segments at the same depth to share the same parameter name.
const menuItemParams = t.Object({ id: t.String({ format: 'uuid' }) })
const groupParams = t.Object({
  id: t.String({ format: 'uuid' }),
  groupId: t.String({ format: 'uuid' }),
})
const optionParams = t.Object({
  id: t.String({ format: 'uuid' }),
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
 * Note: the first dynamic segment is named `:id` (not `:menuItemId`) to match the param name used
 * by the US-015 plugin at the same depth in the shared memoirist router trie.
 *
 * See docs/product/menu.md (US-6.3).
 */
export const optionGroupsRoutes = new Elysia({ prefix: '/menu-items' })
  .use(authGuard)
  .guard({ auth: ['ADMIN'] })
  .get(
    '/:id/option-groups',
    async ({ auth, params }) => {
      const optionGroups = await listOptionGroupsUseCase(db, auth.restaurantId, params.id)
      return { data: { optionGroups } }
    },
    {
      params: menuItemParams,
      detail: { tags: ['Option Groups'], summary: 'List a menu item option groups + options' },
      response: { 200: t.Object({ data: t.Object({ optionGroups: t.Array(optionGroupView) }) }) },
    },
  )
  .post(
    '/:id/option-groups',
    async ({ auth, params, body, set }) => {
      const optionGroup = await createOptionGroupUseCase(db, auth.restaurantId, params.id, body)
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
    '/:id/option-groups/:groupId',
    async ({ auth, params, body }) => {
      const optionGroup = await updateOptionGroupUseCase(
        db,
        auth.restaurantId,
        params.id,
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
    '/:id/option-groups/:groupId',
    async ({ auth, params, set }) => {
      await deleteOptionGroupUseCase(db, auth.restaurantId, params.id, params.groupId)
      set.status = 204
    },
    {
      params: groupParams,
      detail: { tags: ['Option Groups'], summary: 'Delete an option group (cascades its options)' },
      response: { 204: t.Void() },
    },
  )
  .post(
    '/:id/option-groups/:groupId/options',
    async ({ auth, params, body, set }) => {
      const option = await createOptionUseCase(
        db,
        auth.restaurantId,
        params.id,
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
    '/:id/option-groups/:groupId/options/:optionId',
    async ({ auth, params, body }) => {
      const option = await updateOptionUseCase(
        db,
        auth.restaurantId,
        params.id,
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
    '/:id/option-groups/:groupId/options/:optionId',
    async ({ auth, params, set }) => {
      await deleteOptionUseCase(db, auth.restaurantId, params.id, params.groupId, params.optionId)
      set.status = 204
    },
    {
      params: optionParams,
      detail: { tags: ['Option Groups'], summary: 'Delete an option' },
      response: { 204: t.Void() },
    },
  )
