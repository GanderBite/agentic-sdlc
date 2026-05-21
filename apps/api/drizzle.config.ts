import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for drizzle-kit');
}

// Use process.env directly so drizzle-kit CLI can read it without
// triggering the full env-validation singleton (which would require all
// env vars to be present at generate/migrate time).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
