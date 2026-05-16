/**
 * Adversarial integration test — constant-time password verification.
 *
 * Asserts that `hasher.verify` is called exactly once on BOTH branches:
 *   (a) unknown email  — verify is called against a fake hash to prevent timing-based
 *       user enumeration (enriched bullet 14).
 *   (b) known email + wrong password — verify is called against the real stored hash.
 *
 * Both branches must return 401 UNAUTHORIZED.
 *
 * Requires Docker to be running on the host.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted: seed env vars before any ESM module evaluates loadEnv().
// ---------------------------------------------------------------------------
vi.hoisted(() => {
  process.env.JWT_SECRET = 'integration-test-secret-must-be-at-least-32bytes';
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  process.env.NODE_ENV = 'test';
});

// ---------------------------------------------------------------------------
// Mock db/client so the service layer uses the test container db.
// ---------------------------------------------------------------------------
import type { TestDb } from '../support/db.ts';

let testDb: TestDb;

vi.mock('../../src/db/client.ts', () => ({
  get db() {
    return testDb.db;
  },
  get pool() {
    return testDb.pool;
  },
  createDb: () => {
    throw new Error('createDb should not be called in integration tests');
  },
}));

// ---------------------------------------------------------------------------
// Spy on defaultPasswordHasher.verify BEFORE importing main.ts so the spy
// wraps the real function at import time.
// ---------------------------------------------------------------------------
import * as passwordsModule from '../../src/modules/auth/passwords.ts';

const verifySpy = vi.spyOn(passwordsModule.defaultPasswordHasher, 'verify');

import { buildApp } from '../../src/main.ts';
import { startPostgresContainer, stopPostgresContainer } from '../support/db.ts';
import { insertSeedUsers, truncate } from '../support/fixtures.ts';
import { SEED_PLAINTEXT } from '../support/passwords.ts';
import { createRequestAgent } from '../support/request.ts';

let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  testDb = await startPostgresContainer();
  // biome-ignore lint/suspicious/noExplicitAny: buildApp reads process.env internally
  app = buildApp(process.env as any);
}, 60_000);

afterAll(async () => {
  await stopPostgresContainer({ pool: testDb.pool, container: testDb.container });
});

beforeEach(async () => {
  await truncate(testDb.db);
  await insertSeedUsers(testDb.db);
  verifySpy.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /auth.login — constant-time hasher.verify invariant', () => {
  it('calls hasher.verify exactly once for an unknown email (timing decoy)', async () => {
    const agent = createRequestAgent(app);

    // arrange: email that does not exist in the database
    const res = await agent.request('/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@nonexistent.test', password: SEED_PLAINTEXT }),
    });

    // assert: 401 status
    expect(res.status).toBe(401);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');

    // assert: verify was called exactly once (timing decoy against fake hash)
    expect(verifySpy).toHaveBeenCalledTimes(1);
  });

  it('calls hasher.verify exactly once for a known email + wrong password', async () => {
    const agent = createRequestAgent(app);

    // arrange: valid user email but wrong password
    const res = await agent.request('/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@seed.test', password: 'Wr0ngP@ssword!' }),
    });

    // assert: 401 status
    expect(res.status).toBe(401);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');

    // assert: verify was called exactly once (against the real stored hash)
    expect(verifySpy).toHaveBeenCalledTimes(1);
  });
});
