import { openapi } from '@elysiajs/openapi'

import pkg from '../../../../package.json'

/**
 * OpenAPI documentation for the HTTP API. Mounted on the /api app with `path: '/docs'`, so
 * the UI is served at /api/docs and the spec JSON at /api/docs/json. Route-level shapes
 * (request, response, tags) are derived from each route's Elysia schema + `detail`.
 * See docs/product/api-conventions.md.
 */
export const openapiPlugin = openapi({
  path: '/docs',
  documentation: {
    info: {
      title: 'Restaurant QR Ordering API',
      version: pkg.version,
      description: 'Backend API for the Restaurant QR ordering system.',
    },
    tags: [{ name: 'Health', description: 'Liveness and database readiness checks.' }],
  },
})
