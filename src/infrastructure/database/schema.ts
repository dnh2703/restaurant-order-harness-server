/**
 * Drizzle schema — the single source of truth for the Restaurant QR Ordering database,
 * mirroring docs/product/data-model.md (which mirrors SPEC §3). The Drizzle client and
 * drizzle-kit both point here.
 *
 * Conventions (enforced by drizzle.config casing: 'snake_case'):
 * - TS fields are camelCase; SQL columns are snake_case.
 * - Primary keys are `uuid` with `gen_random_uuid()`.
 * - Money is `integer` VND — never float.
 * - FK delete behavior follows US-002 design: cascade pure containment (tokens, order
 *   items, options); restrict deletes of rows referenced by billed history.
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// --- Enums -----------------------------------------------------------------------

export const userRole = pgEnum('user_role', ['ADMIN', 'KITCHEN', 'CASHIER'])
export const tableStatus = pgEnum('table_status', ['EMPTY', 'OCCUPIED'])
export const optionGroupType = pgEnum('option_group_type', ['SINGLE', 'MULTI'])
export const orderStatus = pgEnum('order_status', ['OPEN', 'PAID', 'CANCELLED'])
export const orderItemStatus = pgEnum('order_item_status', [
  'PENDING',
  'COOKING',
  'SERVED',
  'CANCELLED',
])
export const paymentMethod = pgEnum('payment_method', ['CASH', 'TRANSFER', 'CARD'])
export const serviceRequestType = pgEnum('service_request_type', ['CALL_STAFF', 'REQUEST_BILL'])
export const serviceRequestStatus = pgEnum('service_request_status', ['OPEN', 'DONE'])

// --- Shared column builders ------------------------------------------------------

const primaryId = () => uuid().primaryKey().defaultRandom()
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow()

// --- Tenancy & staff -------------------------------------------------------------

export const restaurants = pgTable('restaurants', {
  id: primaryId(),
  name: text().notNull(),
  address: text(),
  phone: text(),
})

export const users = pgTable(
  'users',
  {
    id: primaryId(),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id),
    email: text().notNull().unique(),
    passwordHash: text().notNull(),
    name: text().notNull(),
    role: userRole().notNull(),
    isActive: boolean().notNull().default(true),
  },
  (t) => [index('users_restaurant_idx').on(t.restaurantId)],
)

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revoked: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    // Active-session lookup: only non-revoked rows are interesting.
    index('refresh_tokens_active_idx')
      .on(t.userId)
      .where(sql`${t.revoked} = false`),
  ],
)

// --- Tables (dining) -------------------------------------------------------------

export const tables = pgTable(
  'tables',
  {
    id: primaryId(),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id),
    name: text().notNull(),
    capacity: integer(),
    qrToken: text().notNull().unique(),
    status: tableStatus().notNull().default('EMPTY'),
  },
  (t) => [index('tables_restaurant_idx').on(t.restaurantId)],
)

// --- Menu ------------------------------------------------------------------------

export const categories = pgTable(
  'categories',
  {
    id: primaryId(),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id),
    name: text().notNull(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [index('categories_restaurant_idx').on(t.restaurantId)],
)

export const menuItems = pgTable(
  'menu_items',
  {
    id: primaryId(),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id),
    name: text().notNull(),
    description: text(),
    price: integer().notNull(),
    imageUrl: text(),
    isAvailable: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [index('menu_items_category_idx').on(t.categoryId)],
)

export const optionGroups = pgTable(
  'option_groups',
  {
    id: primaryId(),
    menuItemId: uuid()
      .notNull()
      .references(() => menuItems.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    type: optionGroupType().notNull(),
    isRequired: boolean().notNull().default(false),
  },
  (t) => [index('option_groups_menu_item_idx').on(t.menuItemId)],
)

export const options = pgTable(
  'options',
  {
    id: primaryId(),
    optionGroupId: uuid()
      .notNull()
      .references(() => optionGroups.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    priceDelta: integer().notNull().default(0),
  },
  (t) => [index('options_group_idx').on(t.optionGroupId)],
)

// --- Orders ----------------------------------------------------------------------

export const orders = pgTable(
  'orders',
  {
    id: primaryId(),
    restaurantId: uuid()
      .notNull()
      .references(() => restaurants.id),
    tableId: uuid()
      .notNull()
      .references(() => tables.id),
    status: orderStatus().notNull().default('OPEN'),
    subtotal: integer().notNull().default(0),
    discountAmount: integer().notNull().default(0),
    discountReason: text(),
    total: integer().notNull().default(0),
    openedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    // Invariant: at most one OPEN order per table (data-model.md). Enforced in the DB.
    uniqueIndex('orders_one_open_per_table_idx')
      .on(t.tableId)
      .where(sql`${t.status} = 'OPEN'`),
  ],
)

export const orderItems = pgTable(
  'order_items',
  {
    id: primaryId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    menuItemId: uuid()
      .notNull()
      .references(() => menuItems.id),
    nameSnapshot: text().notNull(),
    unitPrice: integer().notNull(),
    quantity: integer().notNull(),
    note: text(),
    status: orderItemStatus().notNull().default('PENDING'),
    createdAt: createdAt(),
    // Stamped (DB now()) the moment the kitchen advances the item to SERVED; null until then.
    servedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('order_items_order_status_idx').on(t.orderId, t.status),
    // Kitchen queue: pending/cooking items ordered by arrival.
    index('order_items_queue_idx').on(t.status, t.createdAt),
    // Recently-served lookup: SERVED items ordered by serve time.
    index('order_items_served_recent_idx').on(t.status, t.servedAt),
  ],
)

export const orderItemOptions = pgTable(
  'order_item_options',
  {
    id: primaryId(),
    orderItemId: uuid()
      .notNull()
      .references(() => orderItems.id, { onDelete: 'cascade' }),
    optionName: text().notNull(),
    priceDelta: integer().notNull(),
  },
  (t) => [index('order_item_options_item_idx').on(t.orderItemId)],
)

export const payments = pgTable(
  'payments',
  {
    id: primaryId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    method: paymentMethod().notNull(),
    amount: integer().notNull(),
    cashierId: uuid()
      .notNull()
      .references(() => users.id),
    paidAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('payments_order_idx').on(t.orderId)],
)

export const serviceRequests = pgTable(
  'service_requests',
  {
    id: primaryId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    type: serviceRequestType().notNull(),
    status: serviceRequestStatus().notNull().default('OPEN'),
    createdAt: createdAt(),
  },
  (t) => [index('service_requests_order_idx').on(t.orderId)],
)
