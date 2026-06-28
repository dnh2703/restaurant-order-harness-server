import { Elysia, t } from 'elysia'

import { loginUseCase } from '../../../application/auth/login'
import { logoutUseCase } from '../../../application/auth/logout'
import { meUseCase } from '../../../application/auth/me'
import { refreshUseCase } from '../../../application/auth/refresh'
import { db } from '../../../infrastructure/database/client'
import { authGuard } from '../plugins/auth-guard'

const userView = t.Object({
  id: t.String({ format: 'uuid' }),
  email: t.String(),
  name: t.String(),
  role: t.Union([t.Literal('ADMIN'), t.Literal('KITCHEN'), t.Literal('CASHIER')]),
  restaurantId: t.String({ format: 'uuid' }),
})

const loginBody = t.Object({
  email: t.String({ format: 'email' }),
  password: t.String({ minLength: 1 }),
})

const refreshBody = t.Object({ refreshToken: t.String({ minLength: 1 }) })

/**
 * Staff authentication routes (US-009). See docs/product/auth-authorization.md.
 *
 * - POST /api/auth/login  email + password → access + refresh tokens (public).
 * - GET  /api/auth/me     current staff profile (requires a valid access token).
 *
 * Customer QR routes are never mounted behind the guard and stay unauthenticated.
 */
export const authRoutes = new Elysia({ prefix: '/auth' })
  .use(authGuard)
  .post(
    '/login',
    async ({ body }) => {
      const data = await loginUseCase(db, body)
      return { data }
    },
    {
      body: loginBody,
      detail: { tags: ['Auth'], summary: 'Staff login (email + password)' },
      response: {
        200: t.Object({
          data: t.Object({
            accessToken: t.String(),
            refreshToken: t.String(),
            user: userView,
          }),
        }),
      },
    },
  )
  .post(
    '/refresh',
    async ({ body }) => {
      const data = await refreshUseCase(db, body.refreshToken)
      return { data }
    },
    {
      body: refreshBody,
      detail: { tags: ['Auth'], summary: 'Exchange a refresh token for a new access token' },
      response: {
        200: t.Object({
          data: t.Object({ accessToken: t.String(), refreshToken: t.String() }),
        }),
      },
    },
  )
  .post(
    '/logout',
    async ({ body, set }) => {
      await logoutUseCase(db, body.refreshToken)
      set.status = 204
    },
    {
      body: refreshBody,
      detail: { tags: ['Auth'], summary: 'Revoke a refresh token (idempotent)' },
      response: { 204: t.Void() },
    },
  )
  .get(
    '/me',
    async ({ auth }) => {
      const user = await meUseCase(db, auth)
      return { data: { user } }
    },
    {
      auth: true,
      detail: { tags: ['Auth'], summary: 'Current staff profile' },
      response: {
        200: t.Object({ data: t.Object({ user: userView }) }),
      },
    },
  )
