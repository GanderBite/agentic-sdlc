import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import type { Db } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the production migrations folder — same one api-migrate uses.
const MIGRATIONS_FOLDER = resolve(__dirname, '../../src/db/migrations');

export interface TestDb {
  db: Db;
  pool: Pool;
  container: StartedPostgreSqlContainer;
  applyMigrations(): Promise<void>;
  reset(): Promise<void>;
}

/**
 * Start a per-test-file Postgres 17 container, run drizzle-kit migrations,
 * and return a typed Drizzle db instance with lifecycle helpers.
 *
 * Call inside beforeAll with a ≥ 60 000 ms timeout.
 */
export async function startPostgresContainer(): Promise<TestDb> {
  const builder = new PostgreSqlContainer('postgres:17-alpine');

  // withReuse() is intentionally disabled: each test file calls stopPostgresContainer in
  // afterAll, so reusing a shared container causes a teardown race — the first file to
  // finish kills the container for all subsequent files (F-004).
  const container = await builder.start();

  const pool = new Pool({
    connectionString: container.getConnectionUri(),
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  const db = drizzle(pool, { schema }) as Db;

  // Install citext extension before migrations.
  // (The 0000_initial.sql migration also emits CREATE EXTENSION IF NOT EXISTS citext,
  // but running it here ensures the extension exists even on a reused container.)
  await pool.query('CREATE EXTENSION IF NOT EXISTS citext;');

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  async function applyMigrations(): Promise<void> {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  }

  async function reset(): Promise<void> {
    // FK order: revoke referencing rows first, then users.
    await db.execute(sql`TRUNCATE TABLE "refresh_token", "user" RESTART IDENTITY CASCADE`);
  }

  return { db, pool, container, applyMigrations, reset };
}

/**
 * Companion teardown helper.  Call inside afterAll.
 * Ends the pool before stopping the container so no in-flight queries hang.
 */
export async function stopPostgresContainer({
  pool,
  container,
}: {
  pool: Pool;
  container: StartedPostgreSqlContainer;
}): Promise<void> {
  await pool.end();
  await container.stop();
}
