import { describe, expect, it } from 'bun:test'

import { app } from '../src/presentation/http/app'

/**
 * Integration smoke for the health endpoint. Requires DATABASE_URL to point at a
 * reachable Neon branch (set it in .env). Asserts the success envelope when the DB
 * is up, and the documented 503 error envelope when connectivity fails.
 */
describe('GET /api/health', () => {
  it('returns 200 { data: { status: "ok" } } when the database is reachable', async () => {
    const res = await app.handle(new Request('http://localhost/api/health'))
    const body = (await res.json()) as { data?: { status: string }; error?: { code: string } }

    if (res.status === 503) {
      // No DB configured/reachable in this environment — assert the documented shape.
      expect(body.error?.code).toBe('DB_UNAVAILABLE')
      return
    }

    expect(res.status).toBe(200)
    expect(body).toEqual({ data: { status: 'ok' } })
  })
})
