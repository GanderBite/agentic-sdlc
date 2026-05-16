/**
 * Integration tests — POST /auth.refresh
 *
 * Covers token rotation, DB row state after rotation, and replay detection.
 * Each test spins up its own Postgres 17 container for isolation.
 *
 * Requires Docker to be running on the host.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'integration-test-secret-must-be-at-least-32bytes';
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  process.env.NODE_ENV = 'test';
});

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

import { buildApp } from '../../src/main.ts';
import { refreshToken } from '../../src/modules/auth/schema.ts';
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
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Login and return the agent with session/refresh/csrf cookies populated. */
async function loginPatient(): Promise<ReturnType<typeof createRequestAgent>> {
  const agent = createRequestAgent(app);
  const res = await agent.request('/auth.login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'patient@seed.test', password: SEED_PLAINTEXT }),
  });
  if (res.status !== 200) {
    throw new Error(`loginPatient failed with status ${res.status}`);
  }
  return agent;
}

// ---------------------------------------------------------------------------
// Happy path — token rotation
// ---------------------------------------------------------------------------

describe('POST /auth.refresh — rotation', () => {
  it('returns 200 with user body', async () => {
    const agent = await loginPatient();

    const res = await agent.request('/auth.refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as { user: { email: string; role: string } };
    expect(body.user).toMatchObject({ email: 'patient@seed.test', role: 'patient' });
  });

  it('issues a new refresh cookie value after rotation', async () => {
    const agent = await loginPatient();

    // Capture the original refresh token value from the cookie jar
    const originalRefresh = agent.cookies().get('refresh');
    expect(originalRefresh, 'refresh cookie must be present after login').toBeTruthy();

    const res = await agent.request('/auth.refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(200);

    // After refresh, the jar should be updated with the new token
    const newRefresh = agent.cookies().get('refresh');
    expect(newRefresh, 'refresh cookie must still be set after rotation').toBeTruthy();
    expect(newRefresh).not.toBe(originalRefresh);
  });

  it('marks the old refresh_token row as revoked_at after rotation', async () => {
    const agent = await loginPatient();

    // Record how many rows exist before refresh
    const before = await testDb.db.select().from(refreshToken);
    expect(before).toHaveLength(1);
    const oldRow = before[0];
    expect(oldRow).toBeDefined();
    expect(oldRow?.revokedAt).toBeNull();

    const res = await agent.request('/auth.refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(200);

    // Old row must now have revoked_at set
    const oldRowAfter = await testDb.db
      .select()
      .from(refreshToken)
      .where(eq(refreshToken.id, oldRow?.id ?? ''));
    expect(oldRowAfter[0]?.revokedAt, 'old token row must have revoked_at set').not.toBeNull();
  });

  it('inserts a new refresh_token row with null revoked_at', async () => {
    const agent = await loginPatient();

    const before = await testDb.db.select().from(refreshToken);
    expect(before).toHaveLength(1);

    const res = await agent.request('/auth.refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(200);

    const after = await testDb.db.select().from(refreshToken);
    expect(after).toHaveLength(2);

    // Exactly one row should still be active (null revoked_at)
    const activeRows = after.filter((r) => r.revokedAt === null);
    expect(activeRows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Sad path — replay detection
// ---------------------------------------------------------------------------

describe('POST /auth.refresh — replay detection', () => {
  it('returns 401 when the original refresh cookie is replayed after rotation', async () => {
    const agent = await loginPatient();

    // Capture the original refresh token before rotation
    const originalRefresh = agent.cookies().get('refresh');
    expect(originalRefresh).toBeTruthy();

    // Perform a legitimate rotation
    const firstRefresh = await agent.request('/auth.refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(firstRefresh.status).toBe(200);

    // Manually restore the old token in the agent jar and attempt replay
    agent.cookies().set('refresh', originalRefresh as string);

    const replayRes = await agent.request('/auth.refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(replayRes.status).toBe(401);

    const body = (await replayRes.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns non-200 when no refresh cookie is present', async () => {
    const agent = createRequestAgent(app);

    const res = await agent.request('/auth.refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    // No refresh cookie → VALIDATION error (422) from the route handler
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(201);
  });
});
