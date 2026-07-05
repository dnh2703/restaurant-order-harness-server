import { describe, expect, it } from 'bun:test'

import { matchesImageSignature } from '../../src/application/menu-items/image-signature'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
// RIFF....WEBP (bytes 8-11 = 'WEBP')
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
])
const HTML = new Uint8Array([...'<html>'].map((c) => c.charCodeAt(0)))

/**
 * US-025: the upload must confirm the file's bytes match the declared image type, not just
 * trust the client-supplied MIME. Only real JPEG/PNG/WebP signatures pass.
 */
describe('matchesImageSignature', () => {
  it('accepts a real JPEG/PNG/WebP that matches its declared type', () => {
    expect(matchesImageSignature(JPEG, 'image/jpeg')).toBe(true)
    expect(matchesImageSignature(PNG, 'image/png')).toBe(true)
    expect(matchesImageSignature(WEBP, 'image/webp')).toBe(true)
  })

  it('rejects a non-image (e.g. HTML) labelled as an image', () => {
    expect(matchesImageSignature(HTML, 'image/png')).toBe(false)
    expect(matchesImageSignature(HTML, 'image/jpeg')).toBe(false)
  })

  it('rejects bytes that do not match the DECLARED type even if they are a valid image', () => {
    expect(matchesImageSignature(PNG, 'image/jpeg')).toBe(false)
    expect(matchesImageSignature(JPEG, 'image/png')).toBe(false)
  })

  it('rejects a truncated/empty buffer', () => {
    expect(matchesImageSignature(new Uint8Array([0xff, 0xd8]), 'image/jpeg')).toBe(false)
    expect(matchesImageSignature(new Uint8Array([]), 'image/png')).toBe(false)
  })

  it('rejects an unknown declared type', () => {
    expect(matchesImageSignature(JPEG, 'image/gif')).toBe(false)
  })
})
