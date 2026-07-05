/**
 * Magic-byte validation for dish image uploads (US-025 / decision 0024). The upload MIME is
 * client-controlled, so we also confirm the leading bytes match the DECLARED image type;
 * a mismatch means the object is not the image it claims to be and is rejected. Only the
 * three supported types are recognised (see ALLOWED_IMAGE_TYPES in upload-dish-image).
 */

/** True if `bytes` starts with the exact signature `sig`. */
function startsWith(bytes: Uint8Array, sig: readonly number[]): boolean {
  if (bytes.length < sig.length) return false
  for (let i = 0; i < sig.length; i += 1) {
    if (bytes[i] !== sig[i]) return false
  }
  return true
}

const JPEG_SIG = [0xff, 0xd8, 0xff] as const
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
// WebP is a RIFF container: bytes 0-3 = 'RIFF', bytes 8-11 = 'WEBP'.
const RIFF_SIG = [0x52, 0x49, 0x46, 0x46] as const
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50] as const

function isWebp(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, RIFF_SIG) || bytes.length < 12) return false
  for (let i = 0; i < WEBP_TAG.length; i += 1) {
    if (bytes[8 + i] !== WEBP_TAG[i]) return false
  }
  return true
}

/** Confirm the file's bytes match the declared content type. */
export function matchesImageSignature(bytes: Uint8Array, declaredType: string): boolean {
  switch (declaredType) {
    case 'image/jpeg':
      return startsWith(bytes, JPEG_SIG)
    case 'image/png':
      return startsWith(bytes, PNG_SIG)
    case 'image/webp':
      return isWebp(bytes)
    default:
      return false
  }
}
