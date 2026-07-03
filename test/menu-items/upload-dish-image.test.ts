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

function imageFile(type: string, size = 16): File {
  return new File([new Uint8Array(size)], 'photo', { type })
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
