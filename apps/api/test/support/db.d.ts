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
import { type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../src/db/schema.js';
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
export declare function startPostgresContainer(): Promise<TestDb>;
//# sourceMappingURL=db.d.ts.map