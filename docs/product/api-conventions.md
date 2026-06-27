# API Conventions

Cross-cutting contract for the Elysia HTTP API. Individual domain docs reference these
rules instead of restating them.

## Base

- Base path: `/api`.
- Transport: JSON over HTTPS. SSE endpoints under `/stream/*` use `text/event-stream`.
- Content type: `application/json; charset=utf-8`.

## Resource Naming

- Plural nouns: `/api/tables`, `/api/menu-items`, `/api/orders`.
- Nested resources for ownership: `/api/orders/:orderId/items`.
- Customer (QR) routes are namespaced and unauthenticated: `/api/qr/:qrToken/...`.
- Staff routes require a Bearer access token and are RBAC-guarded.

## HTTP Methods & Status Codes

| Method | Use | Success |
| --- | --- | --- |
| GET | read | 200 |
| POST | create / action | 201 created, 200 action |
| PATCH | partial update | 200 |
| PUT | full replace | 200 |
| DELETE | remove | 204 |

Errors: `400` validation, `401` unauthenticated, `403` forbidden (wrong role),
`404` not found, `409` conflict (e.g. invalid state transition), `422` semantic
validation, `500` server.

## Response Envelope

Success returns the resource (or `{ "data": ... }` for collections with metadata):

```json
{ "data": { }, "meta": { } }
```

Error envelope is consistent and machine-readable:

```json
{
  "error": {
    "code": "INVALID_TABLE",
    "message": "Human readable message",
    "details": { }
  }
}
```

`code` is a stable SCREAMING_SNAKE string; clients branch on `code`, not `message`.

## Money

- All monetary fields are integers in VND, named `price`, `unit_price`, `subtotal`,
  `discount_amount`, `total`, `amount`, `price_delta`.
- Never send floats or formatted currency strings; formatting is a client concern.

## Auth Header

- `Authorization: Bearer <access_token>` on staff routes.
- Access token claims: `userId`, `role`, `restaurantId`, `exp` (~15 min).
- See [`auth-authorization.md`](auth-authorization.md) for refresh/logout.

## Validation

- Validate request bodies at the presentation layer (Elysia schema / `drizzle-zod`).
- Reject unknown enum values, negative money, and quantity < 1 with `400`/`422`.

## Idempotency & State Transitions

- Status transitions are validated server-side; an illegal transition returns `409`
  with `code: INVALID_TRANSITION` and does not partially apply.
- Order submission appends items to the existing `OPEN` order; it does not create a
  second open order for the same table.

## Pagination

- List endpoints that can grow (orders, reports) accept `?limit=&cursor=`; default
  `limit=50`, max `200`. Return `meta.nextCursor` when more rows exist.
