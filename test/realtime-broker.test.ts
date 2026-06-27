import { describe, expect, it } from 'bun:test'

import { RealtimeBroker, topicForOrder } from '../src/infrastructure/realtime/realtime-broker'

function payload(orderId: string, status = 'COOKING', op = 'UPDATE'): string {
  return JSON.stringify({
    type: 'order_item',
    orderId,
    orderItemId: 'item-1',
    status,
    op,
  })
}

describe('topicForOrder', () => {
  it('namespaces by order id', () => {
    expect(topicForOrder('abc')).toBe('order:abc')
  })
})

describe('RealtimeBroker fan-out', () => {
  it('delivers an event to a subscriber of the matching order topic', async () => {
    const broker = new RealtimeBroker({ connectionString: 'unused' })
    const sub = broker.subscribe(topicForOrder('A'))
    broker.publish(payload('A', 'SERVED'))
    const result = await sub.events.next()
    expect(result.done).toBe(false)
    expect(result.value.orderId).toBe('A')
    expect(result.value.status).toBe('SERVED')
    sub.unsubscribe()
  })

  it('does not deliver events for other orders', async () => {
    const broker = new RealtimeBroker({ connectionString: 'unused' })
    const sub = broker.subscribe(topicForOrder('A'))
    broker.publish(payload('B')) // wrong order, must be skipped
    broker.publish(payload('A')) // the one this subscriber should see
    const result = await sub.events.next()
    expect(result.value.orderId).toBe('A')
    sub.unsubscribe()
  })

  it('ignores malformed payloads without throwing', async () => {
    const broker = new RealtimeBroker({ connectionString: 'unused' })
    const sub = broker.subscribe(topicForOrder('A'))
    broker.publish('not json{')
    broker.publish(payload('A'))
    const result = await sub.events.next()
    expect(result.value.orderId).toBe('A')
    sub.unsubscribe()
  })

  it('stops delivering after unsubscribe', async () => {
    const broker = new RealtimeBroker({ connectionString: 'unused' })
    const sub = broker.subscribe(topicForOrder('A'))
    sub.unsubscribe()
    const result = await sub.events.next()
    expect(result.done).toBe(true)
  })
})
