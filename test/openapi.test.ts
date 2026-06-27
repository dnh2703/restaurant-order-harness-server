import { describe, expect, it } from 'bun:test'

// env.ts requires DATABASE_URL at import time; set a dummy before importing the app.
// The OpenAPI endpoint never connects to the database, so no real DB is needed.
process.env.DATABASE_URL ??= 'postgresql://ci:ci@localhost:5432/ci'
const { app } = await import('../src/presentation/http/app')

describe('OpenAPI docs', () => {
  it('serves an OpenAPI document that includes the health route', async () => {
    const res = await app.handle(new Request('http://localhost/api/openapi/json'))
    expect(res.status).toBe(200)

    const spec = (await res.json()) as {
      info: { title: string }
      paths: Record<string, unknown>
    }
    expect(spec.info.title).toBe('Restaurant QR Ordering API')
    expect(Object.keys(spec.paths).some((path) => path.includes('/health'))).toBe(true)
  })
})
