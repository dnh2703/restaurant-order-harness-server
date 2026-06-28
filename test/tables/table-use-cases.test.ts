import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { createTableUseCase } from '../../src/application/tables/create-table'
import { listTablesUseCase } from '../../src/application/tables/list-tables'
import { regenerateQrUseCase } from '../../src/application/tables/regenerate-qr'
import { updateTableUseCase } from '../../src/application/tables/update-table'
import { AppError } from '../../src/shared/errors'
import { db } from '../../src/infrastructure/database/client'
import { orders, restaurants, tables } from '../../src/infrastructure/database/schema'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'

let schemaAvailable = false
let restaurantId = ''

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  const [r] = await db
    .insert(restaurants)
    .values({ name: 'US-017 use-cases' })
    .returning({ id: restaurants.id })
  restaurantId = r!.id
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (!schemaAvailable || !restaurantId) return
  await db.delete(orders).where(eq(orders.restaurantId, restaurantId)) // cascades order_items
  await db.delete(tables).where(eq(tables.restaurantId, restaurantId))
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId))
}, DB_TIMEOUT_MS)

describe('tables use-cases', () => {
  it(
    'create mints a non-empty qrToken, defaults status EMPTY, and lists ordered by name',
    async () => {
      if (!schemaAvailable) return
      const b = await createTableUseCase(db, restaurantId, { name: 'Bàn B', capacity: 2 })
      const a = await createTableUseCase(db, restaurantId, { name: 'Bàn A' })
      expect(a.qrToken.length).toBeGreaterThan(0)
      expect(a.status).toBe('EMPTY')
      expect(a.capacity).toBeNull()
      expect(b.capacity).toBe(2)

      const listed = await listTablesUseCase(db, restaurantId)
      const names = listed.map((t) => t.name)
      expect(names.indexOf('Bàn A')).toBeLessThan(names.indexOf('Bàn B'))
    },
    DB_TIMEOUT_MS,
  )

  it(
    'update patches only sent fields and 404s a cross-tenant id',
    async () => {
      if (!schemaAvailable) return
      const created = await createTableUseCase(db, restaurantId, { name: 'Patch me', capacity: 2 })
      const patched = await updateTableUseCase(db, restaurantId, created.id, { capacity: 8 })
      expect(patched.name).toBe('Patch me')
      expect(patched.capacity).toBe(8)

      await expect(
        updateTableUseCase(db, restaurantId, randomUUID(), { name: 'x' }),
      ).rejects.toEqual(new AppError('TABLE_NOT_FOUND'))
    },
    DB_TIMEOUT_MS,
  )

  it(
    'regenerate replaces the qrToken with a different value',
    async () => {
      if (!schemaAvailable) return
      const created = await createTableUseCase(db, restaurantId, { name: 'Re-token' })
      const regenerated = await regenerateQrUseCase(db, restaurantId, created.id)
      expect(regenerated.qrToken).not.toBe(created.qrToken)
      expect(regenerated.qrToken.length).toBeGreaterThan(0)

      await expect(regenerateQrUseCase(db, restaurantId, randomUUID())).rejects.toEqual(
        new AppError('TABLE_NOT_FOUND'),
      )
    },
    DB_TIMEOUT_MS,
  )
})
