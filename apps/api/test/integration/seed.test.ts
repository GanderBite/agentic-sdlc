/**
 * seed.test.ts — integration tests for apps/api/src/seed/main.ts
 *
 * Verifies idempotent seeding behaviour:
 *   - After the first run: user table row count equals the number of entries
 *     in users.json.
 *   - After the second run (same DB, same data): row count is unchanged and
 *     the run exits 0 (no error thrown).
 *   - Each inserted row has a non-empty password_hash that starts with the
 *     argon2id prefix "$argon2id$".
 *
 * Requires Docker daemon running on the host (testcontainers).
 */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgres } from '../support/container.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_MAIN = resolve(__dirname, '../../src/seed/main.ts');
const FIXTURES_PATH = resolve(__dirname, '../../src/seed/fixtures/users.json');
const TSX_BIN = resolve(__dirname, '../../node_modules/.bin/tsx');

// ---------------------------------------------------------------------------
// Fixture count (read at module evaluation, before any test runs)
// ---------------------------------------------------------------------------

const FIXTURE_COUNT: number = (JSON.parse(readFileSync(FIXTURES_PATH, 'utf8')) as unknown[]).length;

// ---------------------------------------------------------------------------
// Container setup (one container per file)
// ---------------------------------------------------------------------------

let stopContainer: () => Promise<void>;
let pool: Pool;

beforeAll(async () => {
  const { url, stop } = await startPostgres();
  stopContainer = stop;
  pool = new Pool({ connectionString: url });
}, 60_000);

afterAll(async () => {
  await pool.end();
  await stopContainer();
});

// ---------------------------------------------------------------------------
// Helper: run seed/main.ts as a subprocess via tsx
// ---------------------------------------------------------------------------

/**
 * Run apps/api/src/seed/main.ts as a child process using tsx.
 * Resolves with the exit code when the process finishes.
 *
 * DATABASE_URL is injected via the child process environment so that the
 * module-level pool in shared/db.ts connects to the test container.
 */
function runSeed(databaseUrl: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(TSX_BIN, [SEED_MAIN], {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
      stdio: 'pipe',
    });

    child.on('error', (err: Error) => {
      reject(new Error(`Failed to spawn tsx: ${err.message}`));
    });

    child.on('close', (code: number | null) => {
      resolve(code ?? 1);
    });
  });
}

// ---------------------------------------------------------------------------
// Helper: count rows in "user" table
// ---------------------------------------------------------------------------

async function countUsers(): Promise<number> {
  const db = drizzle(pool);
  const result = await db.execute<{ c: number }>(
    sql`SELECT COUNT(*)::int AS c FROM "user"`,
  );
  const first = result.rows[0];
  if (first === undefined) {
    throw new Error('COUNT query returned no rows');
  }
  return first.c;
}

// ---------------------------------------------------------------------------
// Helper: fetch all password_hash values from "user" table
// ---------------------------------------------------------------------------

async function fetchPasswordHashes(): Promise<string[]> {
  const db = drizzle(pool);
  const result = await db.execute<{ password_hash: string }>(
    sql`SELECT password_hash FROM "user"`,
  );
  return result.rows.map((row) => row.password_hash);
}

// ---------------------------------------------------------------------------
// Test suite — seed idempotent behaviour
// ---------------------------------------------------------------------------

describe('seed — idempotent seed via main.ts', () => {
  // Capture the container URL once so we can pass it to both runs.
  let containerUrl: string;

  beforeAll(async () => {
    // Retrieve the connection string from the already-started pool.
    // The pool was created with the container URL; extract it from pg config.
    const poolConfig = pool.options as { connectionString?: string };
    const url = poolConfig.connectionString;
    if (url === undefined) {
      throw new Error('Could not determine container URL from pool config');
    }
    containerUrl = url;
  });

  it(
    'first run inserts exactly FIXTURE_COUNT rows and exits 0',
    async () => {
      const exitCode = await runSeed(containerUrl);

      expect(exitCode, 'seed main.ts must exit 0 on first run').toBe(0);

      const count = await countUsers();
      expect(count, `expected ${FIXTURE_COUNT} rows after first seed run`).toBe(FIXTURE_COUNT);
    },
    30_000,
  );

  it(
    'second run (twice / idempotent) leaves row count unchanged and exits 0',
    async () => {
      const exitCode = await runSeed(containerUrl);

      expect(exitCode, 'seed main.ts must exit 0 on second (idempotent) run').toBe(0);

      const count = await countUsers();
      expect(
        count,
        `row count must be unchanged after second seed run (idempotent); expected ${FIXTURE_COUNT}`,
      ).toBe(FIXTURE_COUNT);
    },
    30_000,
  );

  it('every inserted row has a non-empty password_hash starting with $argon2id$', async () => {
    const hashes = await fetchPasswordHashes();

    expect(hashes.length, 'expected at least one user row').toBeGreaterThan(0);

    for (const hash of hashes) {
      expect(hash, 'password_hash must not be empty').not.toBe('');
      expect(
        hash.startsWith('$argon2id$'),
        `password_hash "${hash.slice(0, 20)}…" must start with $argon2id$`,
      ).toBe(true);
    }
  });
});
