/**
 * container.ts — per-test-file ephemeral Postgres container
 *
 * Usage (in integration tests):
 *
 *   beforeAll(async () => {
 *     const { url, stop } = await startPostgres();
 *     // build db + app here...
 *   }, 60_000);
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, '../../src/db/migrations');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type StartedPostgresResult = {
  /** Full postgres:// connection string for this container. */
  readonly url: string;
  /** Tear down the pool and stop the container. Call in afterAll. */
  readonly stop: () => Promise<void>;
};

/**
 * Start an ephemeral Postgres 17 container, apply production migrations, and
 * return the connection URL plus a stop function.
 *
 * Designed to be called from `beforeAll` with a timeout of 60_000 ms:
 *
 *   beforeAll(async () => { ... }, 60_000)
 *
 * Reuse is enabled when `process.env.CI !== "true"` to speed up local runs.
 */
export async function startPostgres(): Promise<StartedPostgresResult> {
  const builder = new PostgreSqlContainer('postgres:17-alpine');

  // Enable Testcontainers daemon reuse on local machines (not CI).
  if (process.env['CI'] !== 'true') {
    builder.withReuse();
  }

  const container: StartedPostgreSqlContainer = await builder.start();
  const url = container.getConnectionUri();

  // Apply production migrations against the fresh container.
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  // Pool is no longer needed after migrations; callers create their own pool.
  await pool.end();

  return {
    url,
    stop: async (): Promise<void> => {
      await container.stop();
    },
  };
}
