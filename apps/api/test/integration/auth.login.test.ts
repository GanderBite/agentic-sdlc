/**
 * Integration tests — POST /auth.login
 *
 * Spins up a dedicated Postgres 17 container, applies migrations, seeds users,
 * and exercises the login route's happy and sad paths.
 *
 * Requires Docker to be running on the host.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted runs before ESM imports so env vars are present when env.ts,
// tokens.ts, and db/client.ts evaluate their module-scope loadEnv() calls.
// ---------------------------------------------------------------------------
vi.hoisted(() => {
  process.env.JWT_SECRET = 'integration-test-secret-must-be-at-least-32bytes';
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  process.env.NODE_ENV = 'test';
});

// ---------------------------------------------------------------------------
// Mock db/client so the production service layer uses the test container db.
// The lazy getters close over `testDb` which is populated in beforeAll.
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

function getSetCookies(res: Response): string[] {
  const h = res.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === 'function') {
    return h.getSetCookie();
  }
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('POST /auth.login — happy path', () => {
  it('returns 200 with body { user: { id, email, role } }', async () => {
    const agent = createRequestAgent(app);

    const res = await agent.request('/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@seed.test', password: SEED_PLAINTEXT }),
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      user: { id: string; email: string; role: string };
    };
    expect(body.user).toMatchObject({
      email: 'patient@seed.test',
      role: 'patient',
    });
    expect(typeof body.user.id).toBe('string');
    expect(body.user.id.length).toBeGreaterThan(0);
  });

  it('sets HttpOnly Secure session cookie', async () => {
    const agent = createRequestAgent(app);

    const res = await agent.request('/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@seed.test', password: SEED_PLAINTEXT }),
    });

    expect(res.status).toBe(200);

    const cookies = getSetCookies(res);
    const sessionCookie = cookies.find((h) => h.startsWith('session='));
    expect(sessionCookie, 'session cookie must be set').toBeTruthy();
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/Secure/i);
  });

  it('sets HttpOnly Secure refresh cookie', async () => {
    const agent = createRequestAgent(app);

    const res = await agent.request('/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'doctor@seed.test', password: SEED_PLAINTEXT }),
    });

    expect(res.status).toBe(200);

    const cookies = getSetCookies(res);
    const refreshCookie = cookies.find((h) => h.startsWith('refresh='));
    expect(refreshCookie, 'refresh cookie must be set').toBeTruthy();
    expect(refreshCookie).toMatch(/HttpOnly/i);
    expect(refreshCookie).toMatch(/Secure/i);
  });

  it('sets non-HttpOnly csrf_token cookie readable by browser JS', async () => {
    const agent = createRequestAgent(app);

    const res = await agent.request('/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@seed.test', password: SEED_PLAINTEXT }),
    });

    expect(res.status).toBe(200);

    const cookies = getSetCookies(res);
    const csrfCookie = cookies.find((h) => h.startsWith('csrf_token='));
    expect(csrfCookie, 'csrf_token cookie must be set').toBeTruthy();
    // csrf_token MUST NOT be HttpOnly — browser JS must be able to read it
    expect(csrfCookie).not.toMatch(/HttpOnly/i);
  });

  it('issues all three cookies in one login response', async () => {
    const agent = createRequestAgent(app);

    const res = await agent.request('/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@seed.test', password: SEED_PLAINTEXT }),
    });

    expect(res.status).toBe(200);

    const cookies = getSetCookies(res);
    const names = cookies.map((c) => c.split('=')[0]);
    expect(names).toContain('session');
    expect(names).toContain('refresh');
    expect(names).toContain('csrf_token');
  });
});

// ---------------------------------------------------------------------------
// Sad paths — 401
// ---------------------------------------------------------------------------

describe('POST /auth.login — sad paths', () => {
  it('returns 401 + UNAUTHORIZED for an unrecognised email', async () => {
    const agent = createRequestAgent(app);

    const res = await agent.request('/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: SEED_PLAINTEXT }),
    });

    expect(res.status).toBe(401);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');

    // No auth cookies should be set on failure
    const cookies = getSetCookies(res);
    expect(cookies).toHaveLength(0);
  });

  it('returns 401 + UNAUTHORIZED for a wrong password', async () => {
    const agent = createRequestAgent(app);

    const res = await agent.request('/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@seed.test', password: 'WrongPassword99!' }),
    });

    expect(res.status).toBe(401);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');

    const cookies = getSetCookies(res);
    expect(cookies).toHaveLength(0);
  });
});
