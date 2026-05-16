/**
 * Adversarial integration test — token-family revocation on replay.
 *
 * Flow:
 *   1. Login → captures original refresh cookie.
 *   2. Refresh (legitimate rotation) → original token is revoked, new token issued.
 *   3. Replay the original cookie → must return 401.
 *   4. Assert: SELECT * FROM refresh_token WHERE user_id = $1 AND revoked_at IS NULL
 *      returns zero rows (entire family revoked).
 *   5. Assert: exactly one warn log line contains both `userId` and `requestId`.
 *
 * Enriched bullet 12.
 *
 * Requires Docker to be running on the host.
 */

import { isNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'integration-test-secret-must-be-at-least-32bytes';
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  process.env.NODE_ENV = 'test';
});

import type { TestDb } from '../support/db.ts';

let testDb: TestDb;

// ---------------------------------------------------------------------------
// Capture warn calls from the service logger.
// The service logger is injected into createAuthService; in production main.ts
// it uses the shared pino logger.  We spy on that shared logger's warn method.
// ---------------------------------------------------------------------------
import * as sharedLogger from '../../src/shared/logger.ts';

const warnSpy = vi.spyOn(sharedLogger.logger, 'warn');

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
  warnSpy.mockClear();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Tests
// ---------------------------------------------------------------------------

describe('POST /auth.refresh — token-family revocation on replay', () => {
  it('returns 401 when the original refresh cookie is replayed after rotation', async () => {
    // arrange: login and capture the original refresh token
    const agent = await loginPatient();
    const originalRefresh = agent.cookies().get('refresh');
    expect(originalRefresh, 'refresh cookie must be present after login').toBeTruthy();

    // act: legitimate rotation
    const firstRefresh = await agent.request('/auth.refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(firstRefresh.status).toBe(200);

    // act: replay the original token
    agent.cookies().set('refresh', originalRefresh as string);

    const replayRes = await agent.request('/auth.refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    // assert: replay must be rejected
    expect(replayRes.status).toBe(401);
    const body = (await replayRes.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('revokes ALL active tokens for the user after a replay is detected', async () => {
    const agent = await loginPatient();
    const originalRefresh = agent.cookies().get('refresh');
    expect(originalRefresh).toBeTruthy();

    // Legitimate rotation
    const firstRefreshRes = await agent.request('/auth.refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(firstRefreshRes.status).toBe(200);

    // Replay the original (compromised) token
    agent.cookies().set('refresh', originalRefresh as string);
    const replayRes = await agent.request('/auth.refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(replayRes.status).toBe(401);

    // Query the DB directly: no active tokens should remain for this user
    const activeTokens = await testDb.db
      .select()
      .from(refreshToken)
      .where(isNull(refreshToken.revokedAt));

    expect(activeTokens).toHaveLength(0);
  });

  it('emits exactly one warn log line containing both userId and requestId', async () => {
    const agent = await loginPatient();
    const originalRefresh = agent.cookies().get('refresh');
    expect(originalRefresh).toBeTruthy();

    // Legitimate rotation
    const firstRefreshRes = await agent.request('/auth.refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(firstRefreshRes.status).toBe(200);

    // Clear spy so we only capture the replay warn
    warnSpy.mockClear();

    // Replay the original token
    agent.cookies().set('refresh', originalRefresh as string);
    const replayRes = await agent.request('/auth.refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(replayRes.status).toBe(401);

    // assert: logger.warn was called exactly once
    const warnCalls = warnSpy.mock.calls;
    expect(warnCalls).toHaveLength(1);

    // The first argument to warn must be an object containing userId and requestId
    const warnArg = warnCalls[0]?.[0] as Record<string, unknown>;
    expect(warnArg).toBeDefined();
    expect(warnArg).toHaveProperty('userId');
    expect(warnArg).toHaveProperty('requestId');
    expect(typeof warnArg.userId).toBe('string');
    expect(typeof warnArg.requestId).toBe('string');
  });
});
