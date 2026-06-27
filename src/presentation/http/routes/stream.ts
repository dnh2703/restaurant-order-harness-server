import { Elysia, sse } from 'elysia'

import { resolveOrderId } from '../../../application/orders/resolve-order-id'
import { db } from '../../../infrastructure/database/client'
import { broker, topicForOrder } from '../../../infrastructure/realtime/realtime-broker'

/** Hold the connection open through idle proxies. */
const KEEPALIVE_MS = 20_000
const KEEPALIVE = Symbol('keepalive')

/**
 * Customer realtime stream (US-008 / SPEC US-9.2). SSE of the table's OPEN order item
 * statuses, authorized by the qrToken (the orderId is resolved server-side, never trusted
 * from the client). On SSE failure the FE should poll GET /api/qr/:qrToken/order every
 * 2–3s (US-9.3).
 */
export const streamRoutes = new Elysia().get(
  '/qr/:qrToken/stream',
  async function* ({ params }) {
    const orderId = await resolveOrderId(db, params.qrToken)
    const subscription = broker.subscribe(topicForOrder(orderId))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // Hold one pending next() across keep-alive ticks so no event is dropped.
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
