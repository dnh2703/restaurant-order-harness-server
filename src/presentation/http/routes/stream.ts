import { Elysia, sse } from 'elysia'

import { resolveOrderId } from '../../../application/orders/resolve-order-id'
import { db } from '../../../infrastructure/database/client'
import {
  broker,
  topicForOrder,
  topicForRestaurant,
} from '../../../infrastructure/realtime/realtime-broker'
import { AppError } from '../../../shared/errors'
import { authGuard } from '../plugins/auth-guard'

/** Hold the connection open through idle proxies. */
const KEEPALIVE_MS = 20_000
const KEEPALIVE = Symbol('keepalive')

/**
 * Shared SSE loop: subscribe to one broker topic, yield order_item.updated events, hold the
 * connection open with keep-alive comments, and always unsubscribe on disconnect. One pending
 * next() is held across keep-alive ticks so no event is dropped (mirrors the US-008 route).
 */
async function* streamTopic(topic: string) {
  const subscription = broker.subscribe(topic)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    let nextEvent = subscription.events.next()
    while (true) {
      const keepAlive = new Promise<typeof KEEPALIVE>((resolve) => {
        timer = setTimeout(() => resolve(KEEPALIVE), KEEPALIVE_MS)
      })
      // oxlint-disable-next-line no-await-in-loop -- sequential await required in SSE generator; Promise.all is impossible for an unbounded stream
      const result = await Promise.race([nextEvent, keepAlive])
      clearTimeout(timer)
      timer = undefined
      if (result === KEEPALIVE) {
        yield sse({ event: 'keep-alive', data: 'ping' })
        continue
      }
      if (result.done) break
      const event = result.value
      yield sse({
        event: 'order_item.updated',
        data: { orderItemId: event.orderItemId, orderId: event.orderId, status: event.status },
      })
      nextEvent = subscription.events.next()
    }
  } finally {
    if (timer) clearTimeout(timer)
    subscription.unsubscribe()
  }
}

/**
 * Realtime SSE routes. The customer route (US-008 / SPEC US-9.2) is unauthenticated and authorized
 * by qrToken (the orderId is resolved server-side, never trusted from the client). The staff route
 * (US-013 / SPEC US-9.1) is authenticated and tenant-scoped: it streams every order_item change in
 * the staff member's restaurant. Both share the same keep-alive SSE loop and the US-008 broker; on
 * SSE failure the FE polls (GET /api/qr/:qrToken/order, or GET /api/kitchen/queue for staff).
 */
export const streamRoutes = new Elysia()
  .use(authGuard)
  .get(
    '/qr/:qrToken/stream',
    async function* ({ params }) {
      const orderId = await resolveOrderId(db, params.qrToken)
      yield* streamTopic(topicForOrder(orderId))
    },
    {
      detail: {
        tags: ['QR Session'],
        summary: "Live SSE of the QR session order's item statuses",
        description:
          'Server-Sent Events of order_item status changes. On SSE failure, poll GET /api/qr/:qrToken/order every 2–3s.',
      },
    },
  )
  .get(
    '/stream/restaurant/:id',
    async function* ({ params, auth }) {
      if (params.id !== auth.restaurantId) throw new AppError('FORBIDDEN')
      yield* streamTopic(topicForRestaurant(auth.restaurantId))
    },
    {
      auth: ['KITCHEN', 'CASHIER', 'ADMIN'],
      detail: {
        tags: ['Realtime'],
        summary: 'Staff restaurant-wide SSE of order_item status changes (US-9.1)',
        description:
          'Server-Sent Events for all order_item changes in the staff member’s restaurant. Path :id must equal the token restaurant. On SSE failure, the FE polls the kitchen queue every 2–3s.',
      },
    },
  )
