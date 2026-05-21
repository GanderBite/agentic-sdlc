/**
 * seed.idempotent.test.ts
 *
 * Verifies that apps/api/src/seed/main.ts is idempotent:
 *   - First run inserts 2 user rows and exits 0.
 *   - Second run inserts 0 rows and exits 0 (idempotent).
 *   - Final row count in the user table is 2.
 *
 * The seed script calls process.exit() at the end so it cannot be imported
 * programmatically. It is invoked twice as a child process via tsx with
 * DATABASE_URL pointing at the test container.
 *
 * Acceptance bullet 13.
 *
 * REQUIRES: Docker daemon running on the host.
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { user } from '../../src/modules/auth/schema.js';

import * as schema from '../../src/db/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the seed entry script. */
const SEED_SCRIPT = resolve(__dirname, '../../src/seed/main.ts');

/** Path to tsx binary in the api package's node_modules. */
const TSX_BIN = resolve(__dirname, '../../node_modules/.bin/tsx');

/** Path to production migrations folder. */
const MIGRATIONS = resolve(__dirname, '../../src/db/migrations');

// ---------------------------------------------------------------------------
// One container per file
// ---------------------------------------------------------------------------

let container: StartedPostgreSqlContainer;
let pool: Pool;
let db: NodePgDatabase<typeof schema>;

beforeAll(async () => {
  const builder = new PostgreSqlContainer('postgres:17-alpine');

  container = await builder.start();
  pool = new Pool({ connectionString: container.getConnectionUri(), max: 5 });
  db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
}, 60_000);

afterAll(async () => {
  await pool.end();
  await container.stop();
}, 30_000);

// ---------------------------------------------------------------------------
// Helper: run seed/main.ts as a child process and return stdout + exit code
// ---------------------------------------------------------------------------

function runSeedTwice(databaseUrl: string): {
  first: { stdout: string; stderr: string; exitCode: number };
  second: { stdout: string; stderr: string; exitCode: number };
} {
  function runOnce(): { stdout: string; stderr: string; exitCode: number } {
    try {
      const stdout = execFileSync(TSX_BIN, [SEED_SCRIPT], {
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          SEED_PASSWORD: 'TestSeedPassword1!',
          NODE_ENV: 'test',
        },
        encoding: 'utf8',
        // Capture stderr too so errors surface in test output
        stdio: ['pipe', 'pipe', 'pipe'],
        // Allow up to 30 seconds for argon2 hashing.
        timeout: 30_000,
      });
      return { stdout, stderr: '', exitCode: 0 };
    } catch (err: unknown) {
      const spawnError = err as { stdout?: string; stderr?: string; status?: number };
      return {
        stdout: spawnError.stdout ?? '',
        stderr: spawnError.stderr ?? '',
        exitCode: spawnError.status ?? 1,
      };
    }
  }

  return { first: runOnce(), second: runOnce() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('seed.idempotent', () => {
  it('when seed script is run twice against the same database, then first run inserts 2 rows, second run inserts 0 rows, final count is 2', async () => {
    const databaseUrl = container.getConnectionUri();

    // act — run the seed script twice against the same container
    const { first, second } = runSeedTwice(databaseUrl);

    // assert — first run exits 0 and reports 2 inserted rows
    if (first.exitCode !== 0) {
      console.error('First seed run failed:', first.stderr, first.stdout);
    }
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain('inserted 2 row(s)');

    // assert — second run exits 0 and reports 0 inserted rows (idempotent)
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain('inserted 0 row(s)');

    // assert — the database contains exactly 2 user rows
    const allRows = await db.select({ email: user.email }).from(user);
    expect(allRows).toHaveLength(2);

    const emails = allRows.map((r) => r.email).sort();
    expect(emails).toEqual(['doctor@medbridge.test', 'patient@medbridge.test']);
  });
});
