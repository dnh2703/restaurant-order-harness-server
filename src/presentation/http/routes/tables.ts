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
