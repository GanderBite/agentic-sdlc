/**
 * Test database support: one Postgres 17 container per test file.
 *
 * REQUIRES: Docker daemon running on the host.
 *
 * Usage in a test file (beforeAll / afterAll):
 *
 *   import { startPostgresContainer, type TestDb } from '../support/db.js';
 *
 *   let testDb: TestDb;
 *
 *   beforeAll(async () => {
 *     testDb = await startPostgresContainer();
 *   }, 60_000);
 *
 *   afterAll(async () => {
 *     await testDb.container.stop();
 *   }, 30_000);
 *
 *   beforeEach(async () => {
 *     await testDb.reset();
 *   });
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { type NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import * as schema from '../../src/db/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the production migrations folder — tests and prod share the same set. */
const MIGRATIONS_FOLDER = resolve(__dirname, '../../src/db/migrations');

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;

export interface TestDb {
  /** Drizzle db instance backed by the test pool. */
  readonly db: Db;
  /** Raw pg.Pool — use for direct SQL in truncate / custom fixtures. */
  readonly pool: Pool;
  /** The running testcontainer — stop it in afterAll. */
  readonly container: StartedPostgreSqlContainer;
  /** Apply the production migration set. Called once by startPostgresContainer. */
  applyMigrations(): Promise<void>;
  /**
   * Truncate all known tables (FK-safe CASCADE) and reset sequences.
   * Call in beforeEach so every test starts from a clean slate.
   */
  reset(): Promise<void>;
}

/**
 * Start a Postgres 17 container, run migrations, and return a TestDb.
 *
 * Container reuse (TESTCONTAINERS_REUSE_ENABLE) is enabled for local runs
 * and disabled on CI (process.env.CI === 'true').
 *
 * Recommended timeout for the enclosing beforeAll: 60_000 ms.
 */
export async function startPostgresContainer(): Promise<TestDb> {
  const builder = new PostgreSqlContainer('postgres:17-alpine');

  // Enable container reuse locally to cut cold-start from ~6 s to ~200 ms.
  // CI always starts fresh (CI=true is set by GitHub Actions).
  if (process.env.CI !== 'true') {
    builder.withReuse();
  }

  const container = await builder.start();

  const pool = new Pool({
    connectionString: container.getConnectionUri(),
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  const db: Db = drizzle(pool, { schema });

  const applyMigrations = async (): Promise<void> => {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  };

  const reset = async (): Promise<void> => {
    // Single-statement TRUNCATE so FK ordering does not matter.
    // refresh_token must precede "user" due to the FK constraint.
    await pool.query('TRUNCATE TABLE refresh_token, "user" RESTART IDENTITY CASCADE');
  };

  // Apply migrations before returning so the caller does not need to.
  await applyMigrations();

  return { db, pool, container, applyMigrations, reset };
}
