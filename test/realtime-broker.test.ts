import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'bun:test'

import {
  RealtimeBroker,
  topicForOrder as topic,
} from '../src/infrastructure/realtime/realtime-broker'

/** Minimal fake pg.Client that records LISTEN and lets the test emit error/end. */
class FakeClient extends EventEmitter {
  listened: string[] = []
  connectCalls = 0
  async connect(): Promise<void> {
    this.connectCalls += 1
  }
  async query(sql: string): Promise<void> {
    this.listened.push(sql)
  }
  async end(): Promise<void> {}
}

describe('RealtimeBroker lifecycle', () => {
  it('connects and issues LISTEN on start', async () => {
    const fake = new FakeClient()
    const broker = new RealtimeBroker({
      connectionString: 'unused',
      clientFactory: () => fake as unknown as import('pg').Client,
    })
    await broker.start()
    expect(fake.connectCalls).toBe(1)
    expect(fake.listened).toContain('LISTEN realtime')
    await broker.stop()
  })

  it('routes a pg notification to subscribers', async () => {
    const fake = new FakeClient()
    const broker = new RealtimeBroker({
      connectionString: 'unused',
      clientFactory: () => fake as unknown as import('pg').Client,
    })
    await broker.start()
    const sub = broker.subscribe(topic('A'))
    fake.emit('notification', {
      channel: 'realtime',
      payload: JSON.stringify({
        type: 'order_item',
        orderId: 'A',
        orderItemId: 'i',
        status: 'COOKING',
        op: 'UPDATE',
      }),
    })
    const result = await sub.events.next()
    expect(result.value.status).toBe('COOKING')
    sub.unsubscribe()
    await broker.stop()
  })

  it('reconnects and re-LISTENs after the connection errors', async () => {
    const clients: FakeClient[] = []
    const broker = new RealtimeBroker({
      connectionString: 'unused',
      clientFactory: () => {
        const c = new FakeClient()
        clients.push(c)
        return c as unknown as import('pg').Client
      },
      backoffMs: () => 5,
    })
    await broker.start()
    clients[0]!.emit('error', new Error('connection lost'))
    await Bun.sleep(40)
    expect(clients.length).toBe(2)
    expect(clients[1]!.listened).toContain('LISTEN realtime')
    await broker.stop()
  })

  it('start() is idempotent — only one client is created on repeated calls', async () => {
    const clients: FakeClient[] = []
    const broker = new RealtimeBroker({
      connectionString: 'unused',
      clientFactory: () => {
        const c = new FakeClient()
        clients.push(c)
        return c as unknown as import('pg').Client
      },
    })
    await broker.start()
    await broker.start()
    expect(clients.length).toBe(1)
    await broker.stop()
  })

  it('stale client error does not trigger a spurious reconnect', async () => {
    const clients: FakeClient[] = []
    const broker = new RealtimeBroker({
      connectionString: 'unused',
      clientFactory: () => {
        const c = new FakeClient()
        clients.push(c)
        return c as unknown as import('pg').Client
      },
      backoffMs: () => 5,
    })
    await broker.start()
    clients[0]!.emit('error', new Error('connection lost'))
    await Bun.sleep(40)
    expect(clients.length).toBe(2) // reconnect happened
    clients[0]!.emit('end') // stale client emits end
    await Bun.sleep(40)
    expect(clients.length).toBe(2) // no third client created
    await broker.stop()
  })
})

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
    expect(topic('abc')).toBe('order:abc')
  })
})

describe('RealtimeBroker fan-out', () => {
  it('delivers an event to a subscriber of the matching order topic', async () => {
    const broker = new RealtimeBroker({ connectionString: 'unused' })
    const sub = broker.subscribe(topic('A'))
    broker.publish(payload('A', 'SERVED'))
    const result = await sub.events.next()
    expect(result.done).toBe(false)
    expect(result.value.orderId).toBe('A')
    expect(result.value.status).toBe('SERVED')
    sub.unsubscribe()
  })

  it('does not deliver events for other orders', async () => {
    const broker = new RealtimeBroker({ connectionString: 'unused' })
    const sub = broker.subscribe(topic('A'))
    broker.publish(payload('B')) // wrong order, must be skipped
    broker.publish(payload('A')) // the one this subscriber should see
    const result = await sub.events.next()
    expect(result.value.orderId).toBe('A')
    sub.unsubscribe()
  })

  it('ignores malformed payloads without throwing', async () => {
    const broker = new RealtimeBroker({ connectionString: 'unused' })
    const sub = broker.subscribe(topic('A'))
    broker.publish('not json{')
    broker.publish(payload('A'))
    const result = await sub.events.next()
    expect(result.value.orderId).toBe('A')
    sub.unsubscribe()
  })

  it('stops delivering after unsubscribe', async () => {
    const broker = new RealtimeBroker({ connectionString: 'unused' })
    const sub = broker.subscribe(topic('A'))
    sub.unsubscribe()
    const result = await sub.events.next()
    expect(result.done).toBe(true)
  })

  it('unsubscribe is a hard stop: queued events are not drained', async () => {
    const broker = new RealtimeBroker({ connectionString: 'unused' })
    const sub = broker.subscribe(topic('A'))
    broker.publish(payload('A', 'COOKING')) // queue an event
    sub.unsubscribe() // hard stop
    const result = await sub.events.next() // should return { done: true }
    expect(result.done).toBe(true)
  })
})
