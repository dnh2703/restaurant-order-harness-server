import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/infrastructure/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Required by drizzle-kit at CLI time; the app validates this separately in env.ts.
    url: process.env.DATABASE_URL ?? '',
  },
  // Domain columns are snake_case (see docs/product/data-model.md); let Drizzle map
  // camelCase TS fields to snake_case columns automatically.
  casing: 'snake_case',
  verbose: true,
  strict: true,
})
