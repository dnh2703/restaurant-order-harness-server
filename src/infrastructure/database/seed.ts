/**
 * Deterministic development/test seed (US-002). `buildSeedData` is a pure, DB-free
 * description of the fixture; `seed` hashes the passwords and inserts everything inside
 * a single transaction, logging row counts so test setup is reproducible.
 *
 * Fixture: 1 restaurant · 1 admin + 1 kitchen + 1 cashier · 3 tables (fixed qr tokens)
 * · 2 categories · 4 dishes, each with one option group. No orders.
 */
import type { Database } from './client'
import { categories, menuItems, optionGroups, options, restaurants, tables, users } from './schema'

type Role = 'ADMIN' | 'KITCHEN' | 'CASHIER'

interface SeedOption {
  name: string
  priceDelta: number
}

interface SeedOptionGroup {
  name: string
  type: 'SINGLE' | 'MULTI'
  isRequired: boolean
  options: SeedOption[]
}

interface SeedMenuItem {
  name: string
  description: string
  price: number
  optionGroup: SeedOptionGroup
}

interface SeedCategory {
  name: string
  sortOrder: number
  menuItems: SeedMenuItem[]
}

interface SeedUser {
  email: string
  password: string
  name: string
  role: Role
}

interface SeedTable {
  name: string
  capacity: number
  qrToken: string
}

export interface SeedData {
  restaurant: { name: string; address: string; phone: string }
  users: SeedUser[]
  tables: SeedTable[]
  categories: SeedCategory[]
}

export function buildSeedData(): SeedData {
  return {
    restaurant: {
      name: 'Quán Cơm Demo',
      address: '123 Lê Lợi, Quận 1, TP.HCM',
      phone: '+84 28 1234 5678',
    },
    users: [
      { email: 'admin@demo.test', password: 'admin-password', name: 'Quản Lý', role: 'ADMIN' },
      {
        email: 'kitchen@demo.test',
        password: 'kitchen-password',
        name: 'Đầu Bếp',
        role: 'KITCHEN',
      },
      {
        email: 'cashier@demo.test',
        password: 'cashier-password',
        name: 'Thu Ngân',
        role: 'CASHIER',
      },
    ],
    tables: [
      { name: 'Bàn 1', capacity: 4, qrToken: 'qr-table-01' },
      { name: 'Bàn 2', capacity: 2, qrToken: 'qr-table-02' },
      { name: 'Bàn 3', capacity: 6, qrToken: 'qr-table-03' },
    ],
    categories: [
      {
        name: 'Món chính',
        sortOrder: 0,
        menuItems: [
          {
            name: 'Cơm tấm sườn',
            description: 'Cơm tấm với sườn nướng',
            price: 45000,
            optionGroup: {
              name: 'Size',
              type: 'SINGLE',
              isRequired: true,
              options: [
                { name: 'Thường', priceDelta: 0 },
                { name: 'Lớn', priceDelta: 10000 },
              ],
            },
          },
          {
            name: 'Phở bò',
            description: 'Phở bò tái nạm',
            price: 50000,
            optionGroup: {
              name: 'Topping',
              type: 'MULTI',
              isRequired: false,
              options: [
                { name: 'Trứng', priceDelta: 5000 },
                { name: 'Bò viên', priceDelta: 12000 },
              ],
            },
          },
        ],
      },
      {
        name: 'Đồ uống',
        sortOrder: 1,
        menuItems: [
          {
            name: 'Trà đá',
            description: 'Trà đá mát lạnh',
            price: 5000,
            optionGroup: {
              name: 'Đá',
              type: 'SINGLE',
              isRequired: false,
              options: [
                { name: 'Bình thường', priceDelta: 0 },
                { name: 'Ít đá', priceDelta: 0 },
              ],
            },
          },
          {
            name: 'Cà phê sữa',
            description: 'Cà phê sữa đá',
            price: 25000,
            optionGroup: {
              name: 'Đường',
              type: 'SINGLE',
              isRequired: false,
              options: [
                { name: 'Bình thường', priceDelta: 0 },
                { name: 'Ít đường', priceDelta: 0 },
              ],
            },
          },
        ],
      },
    ],
  }
}

export interface SeedCounts {
  restaurants: number
  users: number
  tables: number
  categories: number
  menuItems: number
  optionGroups: number
  options: number
}

/**
 * Insert the deterministic fixture. Idempotency is the caller's concern: run against a
 * fresh/branch database. Returns the row counts it created (also logged).
 */
export async function seed(db: Database): Promise<SeedCounts> {
  const data = buildSeedData()
  const counts: SeedCounts = {
    restaurants: 0,
    users: 0,
    tables: 0,
    categories: 0,
    menuItems: 0,
    optionGroups: 0,
    options: 0,
  }

  // Inserts are intentionally sequential: each child row needs the parent's generated
  // id (restaurant → users/tables/categories → menu items → option groups → options),
  // so they cannot be parallelized with Promise.all.
  /* eslint-disable no-await-in-loop */
  await db.transaction(async (tx) => {
    const [restaurant] = await tx
      .insert(restaurants)
      .values(data.restaurant)
      .returning({ id: restaurants.id })
    counts.restaurants = 1
    const restaurantId = restaurant!.id

    for (const user of data.users) {
      await tx.insert(users).values({
        restaurantId,
        email: user.email,
        passwordHash: await Bun.password.hash(user.password),
        name: user.name,
        role: user.role,
      })
      counts.users++
    }

    for (const table of data.tables) {
      await tx.insert(tables).values({ restaurantId, ...table })
      counts.tables++
    }

    for (const category of data.categories) {
      const [insertedCategory] = await tx
        .insert(categories)
        .values({ restaurantId, name: category.name, sortOrder: category.sortOrder })
        .returning({ id: categories.id })
      counts.categories++

      for (const dish of category.menuItems) {
        const [insertedItem] = await tx
          .insert(menuItems)
          .values({
            categoryId: insertedCategory!.id,
            name: dish.name,
            description: dish.description,
            price: dish.price,
          })
          .returning({ id: menuItems.id })
        counts.menuItems++

        const [insertedGroup] = await tx
          .insert(optionGroups)
          .values({
            menuItemId: insertedItem!.id,
            name: dish.optionGroup.name,
            type: dish.optionGroup.type,
            isRequired: dish.optionGroup.isRequired,
          })
          .returning({ id: optionGroups.id })
        counts.optionGroups++

        for (const option of dish.optionGroup.options) {
          await tx.insert(options).values({
            optionGroupId: insertedGroup!.id,
            name: option.name,
            priceDelta: option.priceDelta,
          })
          counts.options++
        }
      }
    }
  })

  /* eslint-enable no-await-in-loop */

  console.info('[seed] inserted rows:', counts)
  return counts
}

// `bun run db:seed` entry. Imports the live client lazily so unit tests of
// buildSeedData never open a connection.
if (import.meta.main) {
  const { db, pool } = await import('./client')
  try {
    await seed(db)
  } finally {
    await pool.end()
  }
}
