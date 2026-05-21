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
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as schema from '../../src/db/schema.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
/** Absolute path to the production migrations folder — tests and prod share the same set. */
const MIGRATIONS_FOLDER = resolve(__dirname, '../../src/db/migrations');
/**
 * Start a Postgres 17 container, run migrations, and return a TestDb.
 *
 * Container reuse (TESTCONTAINERS_REUSE_ENABLE) is enabled for local runs
 * and disabled on CI (process.env.CI === 'true').
 *
 * Recommended timeout for the enclosing beforeAll: 60_000 ms.
 */
export async function startPostgresContainer() {
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
    const db = drizzle(pool, { schema });
    const applyMigrations = async () => {
        await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    };
    const reset = async () => {
        // Single-statement TRUNCATE so FK ordering does not matter.
        // refresh_token must precede "user" due to the FK constraint.
        await pool.query('TRUNCATE TABLE refresh_token, "user" RESTART IDENTITY CASCADE');
    };
    // Apply migrations before returning so the caller does not need to.
    await applyMigrations();
    return { db, pool, container, applyMigrations, reset };
}
//# sourceMappingURL=db.js.map