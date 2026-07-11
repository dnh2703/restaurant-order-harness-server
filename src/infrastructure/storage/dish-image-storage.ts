import { S3Client } from 'bun'

import { AppError } from '../../shared/errors'
import { env } from '../config/env'
import { logger } from '../logging/logger'

/**
 * Port for storing dish images (US-021). The application layer depends on this interface,
 * not on any S3/R2 SDK, so use cases stay pure and tests inject a fake. The concrete
 * implementation is a thin adapter over Bun's S3 client pointed at Cloudflare R2
 * (decision 0021) — like `database/client.ts`, it is infra wiring proven by manual smoke,
 * not unit tests.
 */
export interface DishImageStorage {
  /** Upload `bytes` under `key` with the given content type. Rejects on failure. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>
  /** Public URL an uploaded object is served from. */
  publicUrl(key: string): string
}

/**
 * Build the R2-backed storage from validated config. R2 is S3-compatible: the endpoint is
 * `https://<accountId>.r2.cloudflarestorage.com` with region `auto`; public reads are served
 * from a separately-configured public base URL (r2.dev or a custom domain), not per-object ACLs.
 */
export function createR2DishImageStorage(config: NonNullable<typeof env.r2>): DishImageStorage {
  const client = new S3Client({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket,
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    region: 'auto',
  })
  return {
    async put(key, bytes, contentType) {
      try {
        // US-029: pin inline rendering explicitly rather than relying on R2/CDN defaults.
        await client.write(key, bytes, { type: contentType, contentDisposition: 'inline' })
      } catch (error) {
        logger.error({ err: error, key }, 'R2 dish image upload failed')
        throw error
      }
    },
    publicUrl(key) {
      return `${config.publicBaseUrl}/${key}`
    },
  }
}

let instance: DishImageStorage | null = null

/**
 * Lazily-constructed shared storage singleton. Lazy so unrelated code paths (and tests) never
 * touch R2 wiring; the route resolves it only when an upload arrives. Throws STORAGE_UNAVAILABLE
 * semantics indirectly: when R2 is unconfigured, construction fails here and the route maps it.
 */
export function dishImageStorage(): DishImageStorage {
  if (instance) return instance
  if (!env.r2) {
    logger.error('R2 storage is not configured; set the R2_* environment variables')
    throw new AppError('STORAGE_UNAVAILABLE')
  }
  instance = createR2DishImageStorage(env.r2)
  return instance
}

/** Test seam: override (or reset with null) the storage singleton. Also the composition wire point. */
export function setDishImageStorage(impl: DishImageStorage | null): void {
  instance = impl
}
