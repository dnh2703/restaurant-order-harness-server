import { randomUUID } from 'node:crypto'

import type { DishImageStorage } from '../../infrastructure/storage/dish-image-storage'
import { AppError } from '../../shared/errors'

/** Max dish image size accepted from an upload (5 MB). */
export const MAX_DISH_IMAGE_BYTES = 5 * 1024 * 1024

/** Accepted content types mapped to the canonical file extension used in the object key. */
export const ALLOWED_IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

export interface UploadDishImageResult {
  url: string
}

/**
 * Validate and store an uploaded dish image (US-021). Rejects a missing/empty file
 * (`IMAGE_MISSING`), an unsupported content type (`IMAGE_TYPE_UNSUPPORTED`), or a file over
 * `MAX_DISH_IMAGE_BYTES` (`IMAGE_TOO_LARGE`) before any storage call. The object key is
 * server-generated and tenant-scoped — `dishes/<restaurantId>/<uuid>.<ext>` — so the client
 * never controls the path. A storage failure is surfaced as `STORAGE_UNAVAILABLE`. Returns the
 * public URL to save on `menu_items.image_url`.
 */
export async function uploadDishImageUseCase(
  storage: DishImageStorage,
  restaurantId: string,
  file: File | null | undefined,
): Promise<UploadDishImageResult> {
  if (!file || file.size === 0) throw new AppError('IMAGE_MISSING')

  const ext = ALLOWED_IMAGE_TYPES[file.type as keyof typeof ALLOWED_IMAGE_TYPES]
  if (!ext) throw new AppError('IMAGE_TYPE_UNSUPPORTED')

  if (file.size > MAX_DISH_IMAGE_BYTES) throw new AppError('IMAGE_TOO_LARGE')

  const key = `dishes/${restaurantId}/${randomUUID()}.${ext}`
  const bytes = new Uint8Array(await file.arrayBuffer())

  try {
    await storage.put(key, bytes, file.type)
  } catch {
    throw new AppError('STORAGE_UNAVAILABLE')
  }

  return { url: storage.publicUrl(key) }
}
