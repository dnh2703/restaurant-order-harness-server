/**
 * End-to-end integration proof for US-008 realtime order stream.
 *
 * Chain under test: real DB status change on `order_items`
 *   → Postgres trigger (Task 5) fires `pg_notify('realtime', ...)`
 *   → broker singleton's LISTEN connection (Tasks 3–4) receives the notification
 *   → fan-out delivers it to an in-process subscriber.
 *
 * Requires a migrated DATABASE_URL (pooled) and a reachable DATABASE_URL_UNPOOLED
 * (direct Neon host) so the broker can hold a persistent LISTEN connection.
 * Self-skips when the DB is unavailable (see ./support/db).
 *
 * Subscribe strategy: we subscribe AFTER inserting the order_item so the PENDING
 * INSERT notification is usually already in flight (and dropped because no subscriber
 * exists yet). We then drain a few events in case the PENDING notification races and
 * arrives after subscribe — the loop breaks as soon as COOKING is seen.
 *
 * Broker-ready probe: broker.start() returns as soon as start() is called, even if
 * the initial connect to DATABASE_URL_UNPOOLED is still pending (the broker retries
 * with backoff). waitForBrokerConnected() confirms the broker's LISTEN connection is
 * up by sending a synthetic pg_notify and checking the broker echoes it back — before
 * running the real test.
 */
import { randomUUID } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'

import { db, pool } from '../src/infrastructure/database/client'
import {
  broker,
  topicForOrder,
  type RealtimeEvent,
} from '../src/infrastructure/realtime/realtime-broker'
import {
  categories,
  menuItems,
  orderItems,
  orders,
  restaurants,
  tables,
} from '../src/infrastructure/database/schema'
import { DB_TIMEOUT_MS, probeMigratedDb, WARMUP_TIMEOUT_MS } from './support/db'

let schemaAvailable = false

/**
 * Await the next event from an async iterator, returning undefined on timeout.
 * The timeout prevents the test from hanging when no notification arrives.
 */
async function nextEvent(
  events: AsyncIterableIterator<RealtimeEvent>,
  timeoutMs = 5_000,
): Promise<RealtimeEvent | undefined> {
  const timeout = new Promise<undefined>((resolve) =>
    setTimeout(() => resolve(undefined), timeoutMs),
  )
  const result = await Promise.race([events.next(), timeout])
  return result && 'value' in result ? result.value : undefined
}

/**
 * Confirm that the broker's LISTEN connection is actually up by sending a synthetic
 * pg_notify through the pooled connection and checking the broker echoes it back.
 * broker.start() may return while the initial connect is still in the retry backoff
 * (Neon scale-to-zero), so we probe until we see a round-trip or exhaust the deadline.
 */
async function waitForBrokerConnected(timeoutMs: number): Promise<boolean> {
  const PROBE_ORDER_ID = '__broker_probe__'
  const probePayload = JSON.stringify({
    type: 'order_item',
    orderId: PROBE_ORDER_ID,
    orderItemId: 'probe',
    status: 'PENDING',
    op: 'INSERT',
  } satisfies RealtimeEvent)

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const sub = broker.subscribe(topicForOrder(PROBE_ORDER_ID))
    try {
      // Send through the pooled connection — Postgres delivers the notification to all
      // LISTENers on the channel including the broker's unpooled direct connection.
      await pool.query('SELECT pg_notify($1, $2)', ['realtime', probePayload])
      const result = await nextEvent(sub.events, 2_000)
      sub.unsubscribe()
      if (result !== undefined) return true
    } catch {
      // Pool connection failed (e.g. Neon still waking) — unsubscribe and retry.
      sub.unsubscribe()
    }
    await Bun.sleep(500)
  }
  return false
}

beforeAll(async () => {
  schemaAvailable = await probeMigratedDb()
  if (schemaAvailable) {
    await broker.start()
    // Confirm the broker's LISTEN connection is up before running tests.
    schemaAvailable = await waitForBrokerConnected(30_000)
  }
}, WARMUP_TIMEOUT_MS)

afterAll(async () => {
  if (schemaAvailable) await broker.stop()
})

// Track created entity ids so afterEach can delete in FK-safe order.
const createdRestaurantIds: string[] = []
const createdCategoryIds: string[] = []
const createdMenuItemIds: string[] = []

afterEach(async () => {
  // Delete in FK-safe order:
  //   orders  (cascades order_items → order_item_options)
  //   menu_items  (order_items gone, safe to delete)
  //   categories  (menu_items gone, safe to delete)
  //   tables  (safe, no dependents remain)
  //   restaurants  (safe, all FK children removed)
  for (const restaurantId of createdRestaurantIds) {
    await db.delete(orders).where(eq(orders.restaurantId, restaurantId))
  }
  if (createdMenuItemIds.length > 0) {
    await db.delete(menuItems).where(inArray(menuItems.id, createdMenuItemIds.splice(0)))
  }
  if (createdCategoryIds.length > 0) {
    await db.delete(categories).where(inArray(categories.id, createdCategoryIds.splice(0)))
  }
  for (const restaurantId of createdRestaurantIds) {
    await db.delete(tables).where(eq(tables.restaurantId, restaurantId))
  }
  if (createdRestaurantIds.length > 0) {
    await db.delete(restaurants).where(inArray(restaurants.id, createdRestaurantIds.splice(0)))
  }
}, DB_TIMEOUT_MS)

describe('realtime: DB status change → broker emits', () => {
  it(
    'delivers an order_item.updated event when status changes to COOKING',
    async () => {
      if (!schemaAvailable) return

      // Arrange: build a minimal restaurant → category → menu item → table → order → order_item.
      const [restaurant] = await db
        .insert(restaurants)
        .values({ name: 'RT Integration Co' })
        .returning({ id: restaurants.id })
      createdRestaurantIds.push(restaurant!.id)

      const [category] = await db
        .insert(categories)
        .values({ restaurantId: restaurant!.id, name: 'Cat' })
        .returning({ id: categories.id })
      createdCategoryIds.push(category!.id)

      const [menuItem] = await db
        .insert(menuItems)
        .values({ categoryId: category!.id, name: 'Pho', price: 50000 })
        .returning({ id: menuItems.id })
      createdMenuItemIds.push(menuItem!.id)

      const [table] = await db
        .insert(tables)
        .values({ restaurantId: restaurant!.id, name: 'T1', qrToken: randomUUID() })
        .returning({ id: tables.id })

      const [order] = await db
        .insert(orders)
        .values({ restaurantId: restaurant!.id, tableId: table!.id })
        .returning({ id: orders.id })

      // Insert the order_item — the trigger fires a PENDING NOTIFY here. We insert first
      // and subscribe after so this notification is usually already in flight before we
      // start listening in-process (and thus dropped). The drain loop below handles the
      // rare race where the PENDING notification arrives after subscribe.
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

      // Subscribe after INSERT so we start capturing only the UPDATE notification.
      const sub = broker.subscribe(topicForOrder(order!.id))

      // Act: update the status — the trigger fires pg_notify('realtime', ...) with COOKING.
      await db.update(orderItems).set({ status: 'COOKING' }).where(eq(orderItems.id, item!.id))

      // Assert: drain events until we see COOKING. If the PENDING INSERT notification
      // races and arrives after we subscribed, we skip past it; the loop exits early
      // once COOKING is found. After 5 attempts with a 5 s per-event timeout we give up.
      let received: RealtimeEvent | undefined
      for (let i = 0; i < 5; i += 1) {
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
