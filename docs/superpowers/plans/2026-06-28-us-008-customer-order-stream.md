# US-008 Realtime Customer Order Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream live `order_item` status changes to a customer over SSE at `GET /api/qr/:qrToken/stream`, backed by a `RealtimeBroker` that holds one direct Postgres `LISTEN` connection and fans `NOTIFY` payloads out to subscribers.

**Architecture:** A Postgres trigger on `order_items` calls `pg_notify('realtime', json)` on insert / status update. A single backend `RealtimeBroker` (own direct, unpooled `pg.Client`) runs `LISTEN realtime`, parses each payload, and fans it out in-memory to subscribers keyed by `order:<orderId>`. The SSE route resolves the orderId from the qrToken, subscribes, and yields events until the client disconnects.

**Tech Stack:** Bun + `bun:test`, Elysia 1.4 (`sse` helper + async-generator streaming), `pg` (node-postgres), Drizzle ORM 0.45, Neon Postgres.

## Global Constraints

- Runtime/test runner: Bun; tests use `bun:test`; run with `bun test`.
- Money is integer VND (not relevant here but a project rule).
- DB-backed suites self-skip when the DB is unreachable via `probeMigratedDb()` from `test/support/db.ts` (`WARMUP_TIMEOUT_MS` in `beforeAll`, `DB_TIMEOUT_MS` per test). Keep `bun test` green with no DB.
- `src/infrastructure/config/env.ts` reads env once and is the only place that touches `process.env`. Required vars throw at import.
- App traffic uses the **pooled** `DATABASE_URL` (PgBouncer). The broker MUST use the **direct** `DATABASE_URL_UNPOOLED` — PgBouncer transaction pooling does not support `LISTEN/NOTIFY`.
- Domain errors throw `AppError('<CODE>')`; the global error handler maps them. Unknown table/qrToken → `AppError('INVALID_TABLE')` (404).
- Lint: `oxlint src test`; format: `prettier`. Both run in CI and via husky/lint-staged on commit.
- Commit messages follow Conventional Commits (commitlint). End commit bodies with `Claude-Session: https://claude.ai/code/session_0118jhikLnQaLTo8Qq6gAQfx`.
- Work happens on branch `feat/us-008-customer-order-stream` (already created).

## File Structure

| File | Responsibility |
| --- | --- |
| `src/infrastructure/config/env.ts` (modify) | add required `databaseUrlUnpooled` |
| `.env.example` (modify), `.env` (modify, local only) | document/set `DATABASE_URL_UNPOOLED` |
| `.github/workflows/ci.yml` (modify) | add dummy `DATABASE_URL_UNPOOLED` |
| `src/infrastructure/database/client.ts` (modify) | add `createListenerClient(connectionString)` direct-client factory |
| `src/infrastructure/realtime/realtime-broker.ts` (create) | `RealtimeBroker` + `broker` singleton + `topicForOrder` + types |
| `drizzle/0001_*.sql` + `drizzle/meta/*` (create) | notify function + trigger |
| `src/application/orders/resolve-order-id.ts` (create) | read-only orderId lookup from qrToken |
| `src/presentation/http/routes/stream.ts` (create) | SSE endpoint |
| `src/presentation/http/app.ts` (modify) | mount `streamRoutes` |
| `src/index.ts` (modify) | `broker.start()` / `broker.stop()` lifecycle |
| `test/realtime-broker.test.ts` (create) | unit: fan-out, parse, unsubscribe, reconnect |
| `test/resolve-order-id.test.ts` (create) | integration (self-skip): lookup + 404s |
| `test/stream.test.ts` (create) | integration (self-skip): SSE content-type, event, 404 |
| `test/realtime-integration.test.ts` (create) | integration (self-skip): trigger → NOTIFY → broker |

---

### Task 1: Add `DATABASE_URL_UNPOOLED` env var

**Files:**
- Modify: `src/infrastructure/config/env.ts`
- Modify: `.env.example`
- Modify: `.github/workflows/ci.yml:15-19`
- Modify (local, not committed): `.env`

**Interfaces:**
- Produces: `env.databaseUrlUnpooled: string`

- [ ] **Step 1: Add the required var to env.ts**

In `src/infrastructure/config/env.ts`, inside the `env` object after `databaseUrl`:

```ts
  databaseUrl: required('DATABASE_URL'),
  databaseUrlUnpooled: required('DATABASE_URL_UNPOOLED'),
```

- [ ] **Step 2: Document it in `.env.example`**

Append to `.env.example`:

```bash

# Direct (non-pooled) Neon host. The realtime broker holds a LISTEN/NOTIFY
# connection, which PgBouncer (the -pooler host) does not support. Use the
# direct host (no -pooler) here. Same DB as DATABASE_URL, different endpoint.
DATABASE_URL_UNPOOLED=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=verify-full
```

- [ ] **Step 3: Add a dummy value to CI**

In `.github/workflows/ci.yml`, under `env:` (after the `DATABASE_URL` line):

```yaml
      DATABASE_URL: postgresql://ci:ci@localhost:5432/ci
      DATABASE_URL_UNPOOLED: postgresql://ci:ci@localhost:5432/ci
```

- [ ] **Step 4: Set your local `.env`**

Add `DATABASE_URL_UNPOOLED=` to your local `.env` with the Neon **direct** host (the same URL as `DATABASE_URL` but with `-pooler` removed from the host). This file is git-ignored.

- [ ] **Step 5: Verify the suite still loads and passes**

Run: `bun test`
Expected: PASS (same as before; no test references the new var yet, but env now requires it — confirm nothing throws at import).

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/config/env.ts .env.example .github/workflows/ci.yml
git commit -m "feat(us-008): add DATABASE_URL_UNPOOLED env for the realtime broker"
```

---

### Task 2: Direct listener client factory

**Files:**
- Modify: `src/infrastructure/database/client.ts`

**Interfaces:**
- Consumes: `env.databaseUrlUnpooled` (Task 1)
- Produces: `createListenerClient(connectionString: string): pg.Client`

- [ ] **Step 1: Add the factory**

In `src/infrastructure/database/client.ts`, add the `Client` import and the factory below the existing exports:

```ts
import { Client, Pool } from 'pg'
```

(adjust the existing `import { Pool } from 'pg'` to include `Client`)

Append:

```ts
/**
 * A standalone, direct (non-pooled) connection for the realtime broker's LISTEN/NOTIFY.
 * PgBouncer transaction pooling (Neon's -pooler host used by DATABASE_URL) cannot hold a
 * LISTEN, so the broker connects to DATABASE_URL_UNPOOLED with its own single Client.
 * Same cold-start tuning rationale as the app pool.
 */
export function createListenerClient(connectionString: string): Client {
  return new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/database/client.ts
git commit -m "feat(us-008): add direct listener client factory for the broker"
```

---

### Task 3: RealtimeBroker — fan-out core (no connection)

**Files:**
- Create: `src/infrastructure/realtime/realtime-broker.ts`
- Test: `test/realtime-broker.test.ts`

**Interfaces:**
- Consumes: `createListenerClient` (Task 2), `env.databaseUrlUnpooled` (Task 1)
- Produces:
  - `type RealtimeEvent = { type: 'order_item'; orderId: string; orderItemId: string; status: 'PENDING'|'COOKING'|'SERVED'|'CANCELLED'; op: 'INSERT'|'UPDATE' }`
  - `interface Subscription { events: AsyncIterableIterator<RealtimeEvent>; unsubscribe(): void }`
  - `function topicForOrder(orderId: string): string` → `order:<orderId>`
  - `class RealtimeBroker` with `subscribe(topic): Subscription`, `publish(rawPayload: string): void` (test seam), `start(): Promise<void>`, `stop(): Promise<void>`
  - `const broker: RealtimeBroker` (singleton)

- [ ] **Step 1: Write the failing tests**

Create `test/realtime-broker.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/realtime-broker.test.ts`
Expected: FAIL with module not found / `RealtimeBroker is not a constructor`.

- [ ] **Step 3: Implement the broker core**

Create `src/infrastructure/realtime/realtime-broker.ts`:

```ts
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
      const queued = queue.shift()
      if (queued) return Promise.resolve({ value: queued, done: false })
      if (closed) return Promise.resolve({ value: undefined as never, done: true })
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

  // start()/stop() added in Task 4.
}

export const broker = new RealtimeBroker({ connectionString: env.databaseUrlUnpooled })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/realtime-broker.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/realtime/realtime-broker.ts test/realtime-broker.test.ts
git commit -m "feat(us-008): add RealtimeBroker fan-out core with subscriber queues"
```

---

### Task 4: RealtimeBroker — connection lifecycle + reconnect

**Files:**
- Modify: `src/infrastructure/realtime/realtime-broker.ts`
- Modify: `test/realtime-broker.test.ts`

**Interfaces:**
- Produces: `RealtimeBroker.start(): Promise<void>`, `RealtimeBroker.stop(): Promise<void>` (the `start`/`stop` referenced by Tasks 8 & later tests)

- [ ] **Step 1: Write the failing tests**

Append to `test/realtime-broker.test.ts`:

```ts
import { EventEmitter } from 'node:events'

import { topicForOrder as topic } from '../src/infrastructure/realtime/realtime-broker'

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
      payload: JSON.stringify({ type: 'order_item', orderId: 'A', orderItemId: 'i', status: 'COOKING', op: 'UPDATE' }),
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
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/realtime-broker.test.ts`
Expected: FAIL — `broker.start is not a function`.

- [ ] **Step 3: Implement lifecycle + reconnect**

In `src/infrastructure/realtime/realtime-broker.ts`, replace the `// start()/stop() added in Task 4.` comment with:

```ts
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
```

> Note: `publish` is reused as the notification handler so parsing/routing lives in one place. `msg` is pg's `Notification` ({ channel, payload }).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/realtime-broker.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 5: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/realtime/realtime-broker.ts test/realtime-broker.test.ts
git commit -m "feat(us-008): add broker LISTEN lifecycle with reconnect/backoff"
```

---

### Task 5: Postgres trigger migration (NOTIFY on order_item change)

**Files:**
- Create: `drizzle/0001_*.sql` (via drizzle-kit custom generate)
- Create/modify: `drizzle/meta/*` (journal + snapshot, generated)

**Interfaces:**
- Produces: a `realtime` channel emitting `{type,orderId,orderItemId,status,op}` on `order_items` insert / status update.

- [ ] **Step 1: Generate an empty custom migration**

Run: `bun run db:generate --custom --name order_item_notify`
Expected: creates `drizzle/0001_order_item_notify.sql` (empty) and adds an entry to `drizzle/meta/_journal.json`.

- [ ] **Step 2: Fill in the migration SQL**

Write into `drizzle/0001_order_item_notify.sql`:

```sql
CREATE OR REPLACE FUNCTION notify_order_item_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'realtime',
    json_build_object(
      'type', 'order_item',
      'orderId', NEW.order_id,
      'orderItemId', NEW.id,
      'status', NEW.status,
      'op', TG_OP
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER order_items_notify
  AFTER INSERT OR UPDATE OF status ON order_items
  FOR EACH ROW EXECUTE FUNCTION notify_order_item_change();
```

- [ ] **Step 3: Apply the migration locally**

Run: `bun run db:migrate`
Expected: applies `0001_order_item_notify` with no error.

- [ ] **Step 4: Manually verify the trigger fires (psql or a quick script)**

In one session run `LISTEN realtime;`, in another update an `order_items` row's status, and confirm a notification arrives. (This is covered automatically by the Task 9 integration test; this manual check is optional if a DB is handy.)

- [ ] **Step 5: Commit**

```bash
git add drizzle/0001_order_item_notify.sql drizzle/meta
git commit -m "feat(us-008): add order_items NOTIFY trigger migration"
```

---

### Task 6: `resolveOrderId` — read-only orderId lookup

**Files:**
- Create: `src/application/orders/resolve-order-id.ts`
- Test: `test/resolve-order-id.test.ts`

**Interfaces:**
- Consumes: `Database` from `client.ts`, `AppError`, `tables`/`orders` schema
- Produces: `resolveOrderId(database: Database, qrToken: string): Promise<string>` — the OPEN order id, or throws `AppError('INVALID_TABLE')`.

- [ ] **Step 1: Write the failing test**

Create `test/resolve-order-id.test.ts` (mirrors the self-skip pattern from `test/qr-session.test.ts`):

```ts
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'

import { resolveOrderId } from '../src/application/orders/resolve-order-id'
import { db } from '../src/infrastructure/database/client'
import { orders, restaurants, tables } from '../src/infrastructure/database/schema'
import { AppError } from '../src/shared/errors'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from './support/db'

let schemaAvailable = false
beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
}, WARMUP_TIMEOUT_MS)

const createdRestaurantIds: string[] = []

async function makeOpenOrder(qrToken: string): Promise<string> {
  const [restaurant] = await db
    .insert(restaurants)
    .values({ name: 'Resolve OrderId Test Co' })
    .returning({ id: restaurants.id })
  createdRestaurantIds.push(restaurant!.id)
  const [table] = await db
    .insert(tables)
    .values({ restaurantId: restaurant!.id, name: 'T1', qrToken })
    .returning({ id: tables.id })
  const [order] = await db
    .insert(orders)
    .values({ restaurantId: restaurant!.id, tableId: table!.id })
    .returning({ id: orders.id })
  return order!.id
}

afterEach(async () => {
  for (const restaurantId of createdRestaurantIds.splice(0)) {
    await db.delete(orders).where(eq(orders.restaurantId, restaurantId))
    await db.delete(tables).where(eq(tables.restaurantId, restaurantId))
    await db.delete(restaurants).where(eq(restaurants.id, restaurantId))
  }
}, DB_TIMEOUT_MS)

describe('resolveOrderId', () => {
  it(
    'returns the OPEN order id for a valid qrToken',
    async () => {
      if (!schemaAvailable) return
      const qrToken = randomUUID()
      const expected = await makeOpenOrder(qrToken)
      const orderId = await resolveOrderId(db, qrToken)
      expect(orderId).toBe(expected)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'throws INVALID_TABLE for an unknown qrToken',
    async () => {
      if (!schemaAvailable) return
      await expect(resolveOrderId(db, randomUUID())).rejects.toBeInstanceOf(AppError)
    },
    DB_TIMEOUT_MS,
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/resolve-order-id.test.ts`
Expected: FAIL — module `resolve-order-id` not found (or, with no DB, the body short-circuits on `schemaAvailable` but the import still fails to resolve).

- [ ] **Step 3: Implement the lookup**

Create `src/application/orders/resolve-order-id.ts`:

```ts
import { and, eq } from 'drizzle-orm'

import type { Database } from '../../infrastructure/database/client'
import { orders, tables } from '../../infrastructure/database/schema'
import { AppError } from '../../shared/errors'

/**
 * Read-only: resolve a `qrToken` to its table's single OPEN order id (US-008 SSE stream).
 * Unlike `ensureOpenOrder`/`resolveTableSession`, this NEVER creates an order — opening a
 * stream must not mutate state. Unknown token, or a table with no OPEN order, → 404.
 */
export async function resolveOrderId(database: Database, qrToken: string): Promise<string> {
  const [row] = await database
    .select({ orderId: orders.id })
    .from(tables)
    .innerJoin(orders, and(eq(orders.tableId, tables.id), eq(orders.status, 'OPEN')))
    .where(eq(tables.qrToken, qrToken))
    .limit(1)

  if (!row) {
    throw new AppError('INVALID_TABLE')
  }
  return row.orderId
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/resolve-order-id.test.ts`
Expected: PASS with a live DB; with no DB the tests self-skip (the `if (!schemaAvailable) return` guards) and the suite is green.

- [ ] **Step 5: Commit**

```bash
git add src/application/orders/resolve-order-id.ts test/resolve-order-id.test.ts
git commit -m "feat(us-008): add read-only resolveOrderId lookup"
```

---

### Task 7: SSE stream route

**Files:**
- Create: `src/presentation/http/routes/stream.ts`
- Modify: `src/presentation/http/app.ts`
- Test: `test/stream.test.ts`

**Interfaces:**
- Consumes: `resolveOrderId` (Task 6), `broker` + `topicForOrder` (Tasks 3–4), `db`
- Produces: `streamRoutes` (Elysia instance), route `GET /api/qr/:qrToken/stream`

- [ ] **Step 1: Write the failing test**

Create `test/stream.test.ts`:

```ts
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'

import { db } from '../src/infrastructure/database/client'
import { broker, topicForOrder } from '../src/infrastructure/realtime/realtime-broker'
import { orders, restaurants, tables } from '../src/infrastructure/database/schema'
import { app } from '../src/presentation/http/app'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from './support/db'

let schemaAvailable = false
beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
}, WARMUP_TIMEOUT_MS)

const createdRestaurantIds: string[] = []

async function makeOpenOrder(qrToken: string): Promise<string> {
  const [restaurant] = await db
    .insert(restaurants)
    .values({ name: 'Stream Test Co' })
    .returning({ id: restaurants.id })
  createdRestaurantIds.push(restaurant!.id)
  const [table] = await db
    .insert(tables)
    .values({ restaurantId: restaurant!.id, name: 'T1', qrToken })
    .returning({ id: tables.id })
  const [order] = await db
    .insert(orders)
    .values({ restaurantId: restaurant!.id, tableId: table!.id })
    .returning({ id: orders.id })
  return order!.id
}

afterEach(async () => {
  for (const restaurantId of createdRestaurantIds.splice(0)) {
    await db.delete(orders).where(eq(orders.restaurantId, restaurantId))
    await db.delete(tables).where(eq(tables.restaurantId, restaurantId))
    await db.delete(restaurants).where(eq(restaurants.id, restaurantId))
  }
}, DB_TIMEOUT_MS)

describe('GET /api/qr/:qrToken/stream', () => {
  it(
    'returns 404 for an unknown qrToken',
    async () => {
      if (!schemaAvailable) return
      const res = await app.handle(
        new Request(`http://localhost/api/qr/${randomUUID()}/stream`),
      )
      expect(res.status).toBe(404)
    },
    DB_TIMEOUT_MS,
  )

  it(
    'streams an order_item.updated event over text/event-stream',
    async () => {
      if (!schemaAvailable) return
      const qrToken = randomUUID()
      const orderId = await makeOpenOrder(qrToken)

      const res = await app.handle(
        new Request(`http://localhost/api/qr/${qrToken}/stream`),
      )
      expect(res.headers.get('content-type')).toContain('text/event-stream')

      const reader = res.body!.getReader()
      // Let the handler subscribe before we publish.
      await Bun.sleep(50)
      broker.publish(
        JSON.stringify({
          type: 'order_item',
          orderId,
          orderItemId: 'i1',
          status: 'COOKING',
          op: 'UPDATE',
        }),
      )
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)
      expect(text).toContain('order_item.updated')
      expect(text).toContain('COOKING')
      await reader.cancel()
    },
    DB_TIMEOUT_MS,
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/stream.test.ts`
Expected: FAIL — route not found (404 for the streaming test on the wrong grounds / missing module `stream`).

- [ ] **Step 3: Implement the route**

Create `src/presentation/http/routes/stream.ts`:

```ts
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
    try {
      // Hold one pending next() across keep-alive ticks so no event is dropped.
      let nextEvent = subscription.events.next()
      while (true) {
        let timer: ReturnType<typeof setTimeout> | undefined
        const keepAlive = new Promise<typeof KEEPALIVE>((resolve) => {
          timer = setTimeout(() => resolve(KEEPALIVE), KEEPALIVE_MS)
        })
        const result = await Promise.race([nextEvent, keepAlive])
        clearTimeout(timer)
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
```

- [ ] **Step 4: Mount the route in app.ts**

In `src/presentation/http/app.ts`, add the import and `.use`:

```ts
import { streamRoutes } from './routes/stream'
```

```ts
export const app = new Elysia({ prefix: '/api' })
  .use(errorHandler)
  .use(openapiPlugin)
  .use(healthRoutes)
  .use(qrRoutes)
  .use(streamRoutes)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test test/stream.test.ts`
Expected: PASS with a live DB; self-skips green without a DB.

- [ ] **Step 6: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS. (If Elysia's generator handler trips a lint `require-yield`/`no-unused` rule, adjust the handler — it does `yield` inside the loop so this should be clean.)

- [ ] **Step 7: Commit**

```bash
git add src/presentation/http/routes/stream.ts src/presentation/http/app.ts test/stream.test.ts
git commit -m "feat(us-008): add SSE customer order stream route"
```

---

### Task 8: Broker lifecycle wiring in the entrypoint

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `broker.start()` / `broker.stop()` (Tasks 3–4)

- [ ] **Step 1: Wire start/stop into index.ts**

Replace `src/index.ts` with:

```ts
import { env } from './infrastructure/config/env'
import { broker } from './infrastructure/realtime/realtime-broker'
import { app } from './presentation/http/app'

await broker.start()

app.listen(env.port)

console.info(`🦊 Restaurant order server running at http://localhost:${env.port}/api`)

async function shutdown(): Promise<void> {
  await broker.stop()
  await app.stop()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
```

- [ ] **Step 2: Smoke-test the server boots**

Run (with a live DB in `.env`): `bun run start` then stop with Ctrl-C.
Expected: logs the running banner, no unhandled errors; Ctrl-C exits cleanly.
(If no DB is handy, run `bun run typecheck` to confirm it compiles; broker.start will retry-reconnect rather than crash.)

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(us-008): start/stop the realtime broker with the server"
```

---

### Task 9: End-to-end integration test (trigger → NOTIFY → broker)

**Files:**
- Create: `test/realtime-integration.test.ts`

**Interfaces:**
- Consumes: `broker` singleton (real connect to `DATABASE_URL_UNPOOLED`), trigger from Task 5

- [ ] **Step 1: Write the test**

Create `test/realtime-integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'

import { db } from '../src/infrastructure/database/client'
import { broker, topicForOrder, type RealtimeEvent } from '../src/infrastructure/realtime/realtime-broker'
import { menuItems, categories, orderItems, orders, restaurants, tables } from '../src/infrastructure/database/schema'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from './support/db'

let schemaAvailable = false
beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (schemaAvailable) await broker.start()
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (schemaAvailable) await broker.stop()
})

const createdRestaurantIds: string[] = []

async function nextEvent(
  events: AsyncIterableIterator<RealtimeEvent>,
  timeoutMs = 5_000,
): Promise<RealtimeEvent | undefined> {
  const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs))
  const result = await Promise.race([events.next(), timeout])
  return result && 'value' in result ? result.value : undefined
}

afterEach(async () => {
  for (const restaurantId of createdRestaurantIds.splice(0)) {
    await db.delete(orders).where(eq(orders.restaurantId, restaurantId))
    await db.delete(menuItems).where(eq(menuItems.categoryId, restaurantId)) // see note below
    await db.delete(categories).where(eq(categories.restaurantId, restaurantId))
    await db.delete(tables).where(eq(tables.restaurantId, restaurantId))
    await db.delete(restaurants).where(eq(restaurants.id, restaurantId))
  }
}, DB_TIMEOUT_MS)

describe('realtime: DB status change → broker emits', () => {
  it(
    'delivers an order_item.updated event when status changes',
    async () => {
      if (!schemaAvailable) return
      // Arrange: restaurant → category → menu item → table → order → order_item.
      const [restaurant] = await db
        .insert(restaurants)
        .values({ name: 'RT Integration Co' })
        .returning({ id: restaurants.id })
      createdRestaurantIds.push(restaurant!.id)
      const [category] = await db
        .insert(categories)
        .values({ restaurantId: restaurant!.id, name: 'Cat' })
        .returning({ id: categories.id })
      const [menuItem] = await db
        .insert(menuItems)
        .values({ categoryId: category!.id, name: 'Pho', price: 50000 })
        .returning({ id: menuItems.id })
      const [table] = await db
        .insert(tables)
        .values({ restaurantId: restaurant!.id, name: 'T1', qrToken: randomUUID() })
        .returning({ id: tables.id })
      const [order] = await db
        .insert(orders)
        .values({ restaurantId: restaurant!.id, tableId: table!.id })
        .returning({ id: orders.id })
      const [item] = await db
        .insert(orderItems)
        .values({
          orderId: order!.id,
          menuItemId: menuItem!.id,
          nameSnapshot: 'Pho',
          unitPrice: 50000,
          quantity: 1,
        })
        .returning({ id: orderItems.id })

      const sub = broker.subscribe(topicForOrder(order!.id))
      // Act: change the item's status — the trigger fires pg_notify.
      await db.update(orderItems).set({ status: 'COOKING' }).where(eq(orderItems.id, item!.id))

      // Assert: the broker delivers it. (The INSERT above may also emit a PENDING event;
      // drain until we see COOKING.)
      let received: RealtimeEvent | undefined
      for (let i = 0; i < 3; i += 1) {
        received = await nextEvent(sub.events)
        if (received?.status === 'COOKING') break
      }
      expect(received?.status).toBe('COOKING')
      expect(received?.orderId).toBe(order!.id)
      sub.unsubscribe()
    },
    DB_TIMEOUT_MS,
  )
})
```

> Note on cleanup: `order_items` cascade-delete with their `orders`, so deleting orders removes them. The `menuItems` delete line above is wrong (it filters by restaurantId on a categoryId column) — replace it with a delete that removes the test's menu items by `categoryId IN (the created category)`, or delete categories after orders since menu_items reference categories. Simplest correct order: delete orders (cascades order_items) → delete menu_items by categoryId → delete categories → delete tables → delete restaurant. Track the created `categoryId`/`menuItemId` in arrays like `createdRestaurantIds` and delete by those ids. Implement the cleanup with explicit id tracking; do not ship the placeholder line.

- [ ] **Step 2: Fix the cleanup to track ids explicitly**

Replace the single `createdRestaurantIds` array with arrays for each created entity (`restaurantIds`, `categoryIds`, `menuItemIds`) populated during Arrange, and in `afterEach` delete in FK-safe order: `orders` (cascades `order_items`) → `menu_items` (by id) → `categories` (by id) → `tables` (by restaurantId) → `restaurants` (by id). This keeps the suite re-runnable.

- [ ] **Step 3: Run the test**

Run: `bun test test/realtime-integration.test.ts`
Expected: PASS with a live, migrated DB (trigger applied in Task 5); self-skips green without a DB.

- [ ] **Step 4: Run the full suite**

Run: `bun test`
Expected: PASS (all suites; DB-backed ones self-skip if no DB).

- [ ] **Step 5: Commit**

```bash
git add test/realtime-integration.test.ts
git commit -m "test(us-008): integration proof DB status change → broker emit"
```

---

### Task 10: Story update, validation evidence, and final checks

**Files:**
- Modify: `docs/stories/epics/E05-realtime/US-008-customer-order-stream.md`

- [ ] **Step 1: Run the full verification gate**

Run: `bun run typecheck && bun run lint && bun run format:check && bun test`
Expected: all PASS.

- [ ] **Step 2: Record the validation in the harness**

Run: `scripts/bin/harness-cli story update --id US-008 --unit 1 --integration 1 --e2e 0 --platform 1`
(If the CLI is unavailable in this environment, note that in the story's Evidence section instead.)

- [ ] **Step 3: Fill in the story's Status + Evidence**

In `docs/stories/epics/E05-realtime/US-008-customer-order-stream.md`:
- Change `## Status` from `planned` to `done`.
- Under `## Evidence`, list: broker unit tests (`test/realtime-broker.test.ts`), resolveOrderId (`test/resolve-order-id.test.ts`), SSE route (`test/stream.test.ts`), trigger→broker integration (`test/realtime-integration.test.ts`), and the trigger migration (`drizzle/0001_order_item_notify.sql`).

- [ ] **Step 4: Commit**

```bash
git add docs/stories/epics/E05-realtime/US-008-customer-order-stream.md
git commit -m "docs(us-008): mark story done with validation evidence"
```

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feat/us-008-customer-order-stream
gh pr create --title "feat: US-008 realtime customer order stream" --body "$(cat <<'BODY'
Implements US-008: SSE stream of order_item statuses for customers.

- RealtimeBroker: single direct (unpooled) LISTEN connection, in-memory fan-out by order:<id>, reconnect/backoff.
- Postgres trigger emits NOTIFY on order_items insert / status change.
- GET /api/qr/:qrToken/stream (SSE), authorized by qrToken; no initial snapshot; FE polls GET /order as fallback.
- New env DATABASE_URL_UNPOOLED for the broker.

Design: docs/superpowers/specs/2026-06-28-us-008-realtime-customer-order-stream-design.md

https://claude.ai/code/session_0118jhikLnQaLTo8Qq6gAQfx
BODY
)"
```

(Merge with a normal merge commit, not squash, per project convention.)

---

## Self-Review

**Spec coverage:**
- D1 endpoint `/api/qr/:qrToken/stream` + qrToken auth → Tasks 6, 7. ✓
- D2 NOTIFY via trigger → Task 5. ✓
- D3 unpooled connection → Tasks 1, 2; broker uses it → Tasks 3, 4. ✓
- D4 no snapshot → stream route yields only live events. ✓
- D5 dedicated `stream.ts` → Task 7. ✓
- Single physical `realtime` channel + in-memory routing → Tasks 3, 4. ✓
- Small payload `{orderItemId, orderId, status}` → Task 7 SSE data. ✓
- Reconnect/backoff under Neon scale-to-zero → Task 4. ✓
- Read-only orderId (no order creation) → Task 6. ✓
- Lifecycle start/stop → Task 8. ✓
- Validation matrix unit/integration/e2e/platform → Tasks 3–4 (unit + reconnect/platform), 6/7/9 (integration), polling fallback documented in route. ✓
- CI dummy env so suite stays green → Task 1. ✓

**Placeholder scan:** The only intentional deferral is Task 9's cleanup, explicitly flagged with a Step 2 instruction to implement id-tracked, FK-safe deletes (not shippable as written). All code steps contain real code.

**Type consistency:** `RealtimeEvent`, `Subscription`, `topicForOrder`, `broker`, `RealtimeBroker({ connectionString, clientFactory?, backoffMs? })`, `start()/stop()/subscribe()/publish()`, `createListenerClient(connectionString)`, `resolveOrderId(database, qrToken)` are used identically across tasks. `publish` doubles as the NOTIFY handler (Task 4 wires `client.on('notification', msg => this.publish(msg.payload))`). ✓
