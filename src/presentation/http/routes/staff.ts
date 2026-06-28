import { Elysia, t } from 'elysia'

import { createStaffUseCase } from '../../../application/staff/create-staff'
import { listStaffUseCase } from '../../../application/staff/list-staff'
import { setStaffActiveUseCase } from '../../../application/staff/set-staff-active'
import { updateStaffUseCase } from '../../../application/staff/update-staff'
import { db } from '../../../infrastructure/database/client'
import { authGuard } from '../plugins/auth-guard'

const roleSchema = t.Union([t.Literal('ADMIN'), t.Literal('KITCHEN'), t.Literal('CASHIER')])

const staffView = t.Object({
  id: t.String({ format: 'uuid' }),
  email: t.String(),
  name: t.String(),
  role: roleSchema,
  restaurantId: t.String({ format: 'uuid' }),
  isActive: t.Boolean(),
})

const createBody = t.Object({
  email: t.String({ format: 'email' }),
  password: t.String({ minLength: 8 }),
  name: t.String({ minLength: 1 }),
  role: roleSchema,
})

const updateBody = t.Object(
  {
    name: t.Optional(t.String({ minLength: 1 })),
    role: t.Optional(roleSchema),
  },
  { minProperties: 1 },
)

const activeBody = t.Object({ isActive: t.Boolean() })

const idParams = t.Object({ id: t.String({ format: 'uuid' }) })

/**
 * Staff account & role administration (US-010). Every route is guarded by `ADMIN` and
 * tenant-scoped: the restaurant always comes from the authenticated admin's token claims
 * (`auth.restaurantId`), never the request body/params, so an admin can never read or
 * mutate another restaurant's users. Responses never include `passwordHash`.
 *
 * See docs/product/auth-authorization.md (US-8.4).
 */
export const staffRoutes = new Elysia({ prefix: '/staff' })
  .use(authGuard)
  .guard({ auth: ['ADMIN'] })
  .get(
    '/',
    async ({ auth }) => {
      const staff = await listStaffUseCase(db, auth.restaurantId)
      return { data: { staff } }
    },
    {
      detail: { tags: ['Staff'], summary: 'List staff in the admin restaurant' },
      response: { 200: t.Object({ data: t.Object({ staff: t.Array(staffView) }) }) },
    },
  )
  .post(
    '/',
    async ({ auth, body, set }) => {
      const user = await createStaffUseCase(db, auth.restaurantId, body)
      set.status = 201
      return { data: { user } }
    },
    {
      body: createBody,
      detail: { tags: ['Staff'], summary: 'Create a staff member' },
      response: { 201: t.Object({ data: t.Object({ user: staffView }) }) },
    },
  )
  .patch(
    '/:id',
    async ({ auth, params, body }) => {
      const user = await updateStaffUseCase(db, auth.restaurantId, params.id, body)
      return { data: { user } }
    },
    {
      params: idParams,
      body: updateBody,
      detail: { tags: ['Staff'], summary: 'Update a staff member name/role' },
      response: { 200: t.Object({ data: t.Object({ user: staffView }) }) },
    },
  )
  .patch(
    '/:id/active',
    async ({ auth, params, body }) => {
      const user = await setStaffActiveUseCase(db, auth.restaurantId, params.id, body.isActive)
      return { data: { user } }
    },
    {
      params: idParams,
      body: activeBody,
      detail: {
        tags: ['Staff'],
        summary: 'Activate/deactivate a staff member (deactivating revokes refresh tokens)',
      },
      response: { 200: t.Object({ data: t.Object({ user: staffView }) }) },
    },
  )
