import type { Client } from 'pg'

import { env } from '../config/env'
import { createListenerClient } from '../database/client'

export type OrderItemStatus = 'PENDING' | 'COOKING' | 'SERVED' | 'CANCELLED'

export interface RealtimeEvent {
  type: 'order_item'
  orderId: string
  orderItemId: string
  status: OrderItemStatus
  op: 'INSERT' | 'UPDATE'
}

export interface Subscription {
  events: AsyncIterableIterator<RealtimeEvent>
  unsubscribe(): void
}

/** The one physical Postgres channel; orderId lives in the payload, routed in-memory. */
const CHANNEL = 'realtime'

export function topicForOrder(orderId: string): string {
  return `order:${orderId}`
}

interface Subscriber {
  push(event: RealtimeEvent): void
  iterator: AsyncIterableIterator<RealtimeEvent>
  close(): void
}

/** A single subscriber: a pull-queue feeding an async iterator with backpressure. */
function createSubscriber(onClose: () => void): Subscriber {
  const queue: RealtimeEvent[] = []
  let pending: ((r: IteratorResult<RealtimeEvent>) => void) | null = null
  let closed = false

  const push = (event: RealtimeEvent): void => {
    if (closed) return
    if (pending) {
      const resolve = pending
      pending = null
      resolve({ value: event, done: false })
    } else {
      queue.push(event)
    }
  }

  const close = (): void => {
    if (closed) return
    closed = true
    if (pending) {
      const resolve = pending
      pending = null
      resolve({ value: undefined as never, done: true })
    }
    onClose()
  }

  const iterator: AsyncIterableIterator<RealtimeEvent> = {
    next(): Promise<IteratorResult<RealtimeEvent>> {
      if (closed) return Promise.resolve({ value: undefined as never, done: true })
      const queued = queue.shift()
      if (queued) return Promise.resolve({ value: queued, done: false })
      return new Promise((resolve) => {
        pending = resolve
      })
    },
    return(): Promise<IteratorResult<RealtimeEvent>> {
      close()
      return Promise.resolve({ value: undefined as never, done: true })
    },
    [Symbol.asyncIterator]() {
      return this
    },
  }

  return { push, iterator, close }
}

type ClientFactory = (connectionString: string) => Client

export interface RealtimeBrokerOptions {
  connectionString: string
  /** Override the pg client (tests inject a fake). */
  clientFactory?: ClientFactory
  /** Backoff for reconnect attempt n (0-based). Tests shorten this. */
  backoffMs?: (attempt: number) => number
}

export class RealtimeBroker {
  private readonly connectionString: string
  private readonly clientFactory: ClientFactory
  private readonly backoffMs: (attempt: number) => number
  private readonly topics = new Map<string, Set<Subscriber>>()
  private client: Client | null = null
  private started = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0

  constructor(options: RealtimeBrokerOptions) {
    this.connectionString = options.connectionString
    this.clientFactory = options.clientFactory ?? createListenerClient
    this.backoffMs = options.backoffMs ?? ((n) => Math.min(30_000, 1_000 * 2 ** n))
  }

  subscribe(topic: string): Subscription {
    let set = this.topics.get(topic)
    if (!set) {
      set = new Set()
      this.topics.set(topic, set)
    }
    const subscribers = set
    const subscriber = createSubscriber(() => {
      subscribers.delete(subscriber)
      if (subscribers.size === 0) this.topics.delete(topic)
    })
    subscribers.add(subscriber)
    return { events: subscriber.iterator, unsubscribe: () => subscriber.close() }
  }

  /** Test seam: feed a raw NOTIFY payload exactly as Postgres would deliver it. */
  publish(rawPayload: string | undefined): void {
    if (!rawPayload) return
    let event: RealtimeEvent
    try {
      event = JSON.parse(rawPayload) as RealtimeEvent
    } catch {
      return // ignore malformed payloads
    }
    if (event.type !== 'order_item' || !event.orderId) return
    const subscribers = this.topics.get(topicForOrder(event.orderId))
    if (!subscribers) return
    for (const subscriber of subscribers) subscriber.push(event)
  }

  async start(): Promise<void> {
    this.started = true
    await this.connect()
  }

  private async connect(): Promise<void> {
    if (!this.started) return
    const client = this.clientFactory(this.connectionString)
    client.on('notification', (msg) => this.publish(msg.payload))
    client.on('error', () => this.scheduleReconnect())
    client.on('end', () => this.scheduleReconnect())
    try {
      await client.connect()
      await client.query(`LISTEN ${CHANNEL}`)
      this.client = client
      this.attempt = 0
    } catch {
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (!this.started || this.reconnectTimer) return
    const delay = this.backoffMs(this.attempt)
    this.attempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delay)
  }

  async stop(): Promise<void> {
    this.started = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    for (const set of this.topics.values()) {
      for (const subscriber of set) subscriber.close()
    }
    this.topics.clear()
    if (this.client) {
      await this.client.end().catch(() => {})
      this.client = null
    }
  }
}

export const broker = new RealtimeBroker({ connectionString: env.databaseUrlUnpooled })
