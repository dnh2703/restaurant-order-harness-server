import { describe, expect, it } from 'bun:test'

import {
  MAX_DISH_IMAGE_BYTES,
  uploadDishImageUseCase,
} from '../../src/application/menu-items/upload-dish-image'
import type { DishImageStorage } from '../../src/infrastructure/storage/dish-image-storage'

const RESTAURANT_ID = '11111111-1111-1111-1111-111111111111'

interface Put {
  key: string
  bytes: Uint8Array
  contentType: string
}

function fakeStorage(overrides: { failPut?: boolean } = {}): DishImageStorage & { puts: Put[] } {
  const puts: Put[] = []
  return {
    puts,
    async put(key, bytes, contentType) {
      if (overrides.failPut) throw new Error('R2 down')
      puts.push({ key, bytes, contentType })
    },
    publicUrl(key) {
      return `https://cdn.test/${key}`
    },
  }
}

/** Magic-byte signatures so fixtures pass the US-025 byte check for their declared type. */
const SIGNATURES: Record<string, readonly number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/webp': [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
}

function imageFile(type: string, size = 16): File {
  const buf = new Uint8Array(size)
  const sig = SIGNATURES[type]
  // Only stamp the signature when there's room; size 0 must stay empty (IMAGE_MISSING case).
  if (sig && size >= sig.length) buf.set(sig, 0)
  return new File([buf], 'photo', { type })
}

describe('uploadDishImageUseCase', () => {
  it('rejects a missing file with IMAGE_MISSING', async () => {
    const storage = fakeStorage()
    await expect(uploadDishImageUseCase(storage, RESTAURANT_ID, null)).rejects.toMatchObject({
      code: 'IMAGE_MISSING',
    })
    await expect(
      uploadDishImageUseCase(storage, RESTAURANT_ID, imageFile('image/jpeg', 0)),
    ).rejects.toMatchObject({ code: 'IMAGE_MISSING' })
    expect(storage.puts).toHaveLength(0)
  })

  it('rejects an unsupported content type with IMAGE_TYPE_UNSUPPORTED', async () => {
    const storage = fakeStorage()
    await expect(
      uploadDishImageUseCase(storage, RESTAURANT_ID, imageFile('image/gif')),
    ).rejects.toMatchObject({ code: 'IMAGE_TYPE_UNSUPPORTED' })
    await expect(
      uploadDishImageUseCase(storage, RESTAURANT_ID, imageFile('application/pdf')),
    ).rejects.toMatchObject({ code: 'IMAGE_TYPE_UNSUPPORTED' })
    expect(storage.puts).toHaveLength(0)
  })

  it('rejects a file over the size cap with IMAGE_TOO_LARGE', async () => {
    const storage = fakeStorage()
    await expect(
      uploadDishImageUseCase(
        storage,
        RESTAURANT_ID,
        imageFile('image/png', MAX_DISH_IMAGE_BYTES + 1),
      ),
    ).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' })
    expect(storage.puts).toHaveLength(0)
  })

  it('rejects a file whose bytes do not match the declared image type (US-025)', async () => {
    const storage = fakeStorage()
    // Declared image/png but the bytes are HTML — must be rejected before any storage call.
    const html = new Uint8Array([...'<html></html>'].map((c) => c.charCodeAt(0)))
    const file = new File([html], 'evil', { type: 'image/png' })
    await expect(uploadDishImageUseCase(storage, RESTAURANT_ID, file)).rejects.toMatchObject({
      code: 'IMAGE_TYPE_UNSUPPORTED',
    })
    expect(storage.puts).toHaveLength(0)
  })

  it('stores under a tenant-scoped key and returns the public URL', async () => {
    const storage = fakeStorage()
    const result = await uploadDishImageUseCase(storage, RESTAURANT_ID, imageFile('image/webp'))
    expect(storage.puts).toHaveLength(1)
    const put = storage.puts[0]!
    expect(put.key).toMatch(new RegExp(`^dishes/${RESTAURANT_ID}/[0-9a-f-]{36}\\.webp$`))
    expect(put.contentType).toBe('image/webp')
    expect(result.url).toBe(`https://cdn.test/${put.key}`)
  })

  it('maps jpeg/png/webp to their canonical extension', async () => {
    const storage = fakeStorage()
    await uploadDishImageUseCase(storage, RESTAURANT_ID, imageFile('image/jpeg'))
    await uploadDishImageUseCase(storage, RESTAURANT_ID, imageFile('image/png'))
    const exts = storage.puts.map((p) => p.key.split('.').pop())
    expect(exts).toEqual(['jpg', 'png'])
  })

  it('maps a storage failure to STORAGE_UNAVAILABLE', async () => {
    const storage = fakeStorage({ failPut: true })
    await expect(
      uploadDishImageUseCase(storage, RESTAURANT_ID, imageFile('image/jpeg')),
    ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
  })
})
