import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { MAX_DISH_IMAGE_BYTES } from '../../src/application/menu-items/upload-dish-image'
import { hashPassword } from '../../src/infrastructure/auth/password'
import { db } from '../../src/infrastructure/database/client'
import { restaurants, users } from '../../src/infrastructure/database/schema'
import {
  type DishImageStorage,
  setDishImageStorage,
} from '../../src/infrastructure/storage/dish-image-storage'
import { app } from '../../src/presentation/http/app'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from '../support/db'
import { errorCode } from '../support/http'

let schemaAvailable = false
const password = 'admin-pw-us021'
const adminEmail = `admin-${randomUUID()}@us021.test`
const cashierEmail = `cashier-${randomUUID()}@us021.test`
let restaurantId = ''

interface Put {
  key: string
  bytes: Uint8Array
  contentType: string
}
const puts: Put[] = []
const fakeStorage: DishImageStorage = {
  async put(key, bytes, contentType) {
    puts.push({ key, bytes, contentType })
  },
  publicUrl(key) {
    return `https://cdn.test/${key}`
  },
}

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (!schemaAvailable) return
  setDishImageStorage(fakeStorage)
  const passwordHash = await hashPassword(password)
  const [r] = await db
    .insert(restaurants)
    .values({ name: `US-021 ${randomUUID()}` })
    .returning({ id: restaurants.id })
  restaurantId = r!.id
  await db.insert(users).values([
    { restaurantId, email: adminEmail, passwordHash, name: 'Admin', role: 'ADMIN' },
    { restaurantId, email: cashierEmail, passwordHash, name: 'Cashier', role: 'CASHIER' },
  ])
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  setDishImageStorage(null)
  if (!schemaAvailable || !restaurantId) return
  await db.delete(users).where(eq(users.restaurantId, restaurantId))
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId))
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

// RIFF....WEBP magic so fixtures pass the US-025 byte check for image/webp.
const WEBP_MAGIC = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]
function webpFile(name = 'p.webp', total = 32): File {
  const buf = new Uint8Array(Math.max(total, WEBP_MAGIC.length))
  buf.set(WEBP_MAGIC, 0)
  return new File([buf], name, { type: 'image/webp' })
}

function uploadReq(
  init: { token?: string; file?: File; omitFile?: boolean } = {},
): Promise<Response> {
  // Filenames carry an extension: Bun's multipart parser derives a part's content type from the
  // filename, matching how real uploads arrive (browsers send a filename + Content-Type per part).
  const form = new FormData()
  if (!init.omitFile) {
    form.set('file', init.file ?? webpFile())
  }
  const headers: Record<string, string> = {}
  if (init.token) headers.authorization = `Bearer ${init.token}`
  return app.handle(
    new Request('http://localhost/api/menu-items/image', { method: 'POST', headers, body: form }),
  )
}

describe('POST /menu-items/image', () => {
  it(
    'rejects a non-admin with 403 and a missing token with 401',
    async () => {
      if (!schemaAvailable) return
      const cashier = await tokenFor(cashierEmail)
      expect((await uploadReq({ token: cashier })).status).toBe(403)
      expect((await uploadReq({})).status).toBe(401)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'uploads a valid image, stores it tenant-scoped, and returns the public URL',
    async () => {
      if (!schemaAvailable) return
      puts.length = 0
      const token = await tokenFor(adminEmail)
      const res = await uploadReq({
        token,
        file: webpFile('dish.webp', 32),
      })
      expect(res.status).toBe(201)
      const { data } = (await res.json()) as { data: { url: string } }
      expect(puts).toHaveLength(1)
      expect(puts[0]!.key).toMatch(new RegExp(`^dishes/${restaurantId}/[0-9a-f-]{36}\\.webp$`))
      expect(puts[0]!.contentType).toBe('image/webp')
      expect(data.url).toBe(`https://cdn.test/${puts[0]!.key}`)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects an unsupported type with 400 IMAGE_TYPE_UNSUPPORTED',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminEmail)
      const res = await uploadReq({
        token,
        file: new File([new Uint8Array(16)], 'x.gif', { type: 'image/gif' }),
      })
      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('IMAGE_TYPE_UNSUPPORTED')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects a file whose bytes do not match the declared image type (US-025)',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminEmail)
      const html = new Uint8Array([...'<html></html>'].map((c) => c.charCodeAt(0)))
      const res = await uploadReq({
        token,
        file: new File([html], 'evil.png', { type: 'image/png' }),
      })
      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('IMAGE_TYPE_UNSUPPORTED')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects an oversize file with 400 IMAGE_TOO_LARGE',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminEmail)
      const res = await uploadReq({
        token,
        file: new File([new Uint8Array(MAX_DISH_IMAGE_BYTES + 1)], 'big.png', {
          type: 'image/png',
        }),
      })
      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('IMAGE_TOO_LARGE')
    },
    DB_TIMEOUT_MS,
  )

  it(
    'rejects a missing file with 400 IMAGE_MISSING',
    async () => {
      if (!schemaAvailable) return
      const token = await tokenFor(adminEmail)
      const res = await uploadReq({ token, omitFile: true })
      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('IMAGE_MISSING')
    },
    DB_TIMEOUT_MS,
  )
})
