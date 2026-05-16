/**
 * Integration tests — CSRF double-submit enforcement on POST /auth.logout
 *
 * Exercises all three CSRF failure modes (missing header, mismatched header,
 * absent cookie) and verifies the success case when the header matches.
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
import { createRequestAgent, csrfHeaders } from '../support/request.ts';

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

/**
 * Login as the patient user and return an authenticated agent.
 * After this call the agent's cookie jar contains session, refresh, csrf_token.
 */
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
// CSRF failure modes — all must return 403 FORBIDDEN
// ---------------------------------------------------------------------------

describe('CSRF enforcement on POST /auth.logout', () => {
  it('returns 403 + FORBIDDEN when X-CSRF-Token header is absent but session is valid', async () => {
    const agent = await loginPatient();

    const res = await agent.request('/auth.logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No X-CSRF-Token header
    });

    expect(res.status).toBe(403);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 + FORBIDDEN when X-CSRF-Token header value does not match the cookie', async () => {
    const agent = await loginPatient();

    const res = await agent.request('/auth.logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'completely-wrong-csrf-value-that-wont-match',
      },
    });

    expect(res.status).toBe(403);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 + FORBIDDEN when csrf_token cookie is absent (header present)', async () => {
    const agent = await loginPatient();

    // Remove the csrf_token from the jar
    agent.cookies().delete('csrf_token');

    const res = await agent.request('/auth.logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'any-value-wont-matter',
      },
    });

    expect(res.status).toBe(403);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 + FORBIDDEN when header value is a prefix of the cookie value', async () => {
    const agent = await loginPatient();

    const realToken = agent.cookies().get('csrf_token') ?? '';
    // Send only a prefix — must NOT match (different length triggers length check)
    const prefixToken = realToken.slice(0, 10);

    const res = await agent.request('/auth.logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': prefixToken,
      },
    });

    expect(res.status).toBe(403);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  // -------------------------------------------------------------------------
  // Success case — matching CSRF
  // -------------------------------------------------------------------------

  it('returns 200 when X-CSRF-Token header exactly matches the csrf_token cookie', async () => {
    const agent = await loginPatient();

    const res = await agent.request('/auth.logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...csrfHeaders(agent),
      },
    });

    expect(res.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // GET is CSRF-exempt (auth.me)
  // -------------------------------------------------------------------------

  it('GET /auth.me does not require X-CSRF-Token header', async () => {
    const agent = await loginPatient();

    // Remove csrf_token from jar to confirm GET is exempt
    agent.cookies().delete('csrf_token');

    const res = await agent.request('/auth.me', {
      method: 'GET',
      // No X-CSRF-Token header
    });

    // Should succeed (200) since GETs are CSRF-exempt
    expect(res.status).toBe(200);
  });
});
