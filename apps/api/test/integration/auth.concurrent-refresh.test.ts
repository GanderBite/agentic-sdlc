/**
 * Adversarial integration test — concurrent token rotation.
 *
 * Fires two simultaneous POST /auth.refresh requests with the same refresh
 * cookie.  Exactly one must succeed with 200 and a new token pair; the other
 * must fail with 401.  The test is tolerant of either ordering.
 *
 * This exercises the atomic UPDATE … WHERE revoked_at IS NULL RETURNING
 * guarantee in repo.rotateRefreshToken (enriched bullet 11).
 *
 * Requires Docker to be running on the host.
 */

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

/** Login and return the agent with all auth cookies populated. */
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

/**
 * Build a raw Request object carrying the given refresh cookie value.
 * Both concurrent requests must carry the SAME cookie to trigger the race.
 */
function makeRefreshRequest(refreshCookieValue: string): Request {
  return new Request('http://localhost/auth.refresh', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `refresh=${refreshCookieValue}`,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /auth.refresh — concurrent rotation race', () => {
  it('allows exactly one winner (200) and rejects the other (401) when two requests race with the same token', async () => {
    // arrange: login and capture the refresh token
    const agent = await loginPatient();
    const originalRefresh = agent.cookies().get('refresh');
    expect(originalRefresh, 'refresh cookie must be present after login').toBeTruthy();

    // act: fire both requests concurrently using the same raw cookie value
    const [res1, res2] = await Promise.all([
      app.fetch(makeRefreshRequest(originalRefresh as string)),
      app.fetch(makeRefreshRequest(originalRefresh as string)),
    ]);

    const statuses = [res1.status, res2.status].sort((a, b) => a - b);

    // assert: one 200 and one 401 — order does not matter
    expect(statuses).toEqual([200, 401]);
  });

  it('the winning request returns a new user body', async () => {
    const agent = await loginPatient();
    const originalRefresh = agent.cookies().get('refresh');
    expect(originalRefresh).toBeTruthy();

    const [res1, res2] = await Promise.all([
      app.fetch(makeRefreshRequest(originalRefresh as string)),
      app.fetch(makeRefreshRequest(originalRefresh as string)),
    ]);

    // Find the 200 response
    const winner = res1.status === 200 ? res1 : res2;
    expect(winner.status).toBe(200);

    const body = (await winner.json()) as { user: { email: string; role: string } };
    expect(body.user).toMatchObject({ email: 'patient@seed.test', role: 'patient' });
  });

  it('the losing request returns UNAUTHORIZED error code', async () => {
    const agent = await loginPatient();
    const originalRefresh = agent.cookies().get('refresh');
    expect(originalRefresh).toBeTruthy();

    const [res1, res2] = await Promise.all([
      app.fetch(makeRefreshRequest(originalRefresh as string)),
      app.fetch(makeRefreshRequest(originalRefresh as string)),
    ]);

    // Find the 401 response
    const loser = res1.status === 401 ? res1 : res2;
    expect(loser.status).toBe(401);

    const body = (await loser.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
