/**
 * Integration tests — POST /auth.logout
 *
 * Validates that logout clears the auth cookies and revokes the refresh token
 * row in the database.
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
import { refreshToken } from '../../src/modules/auth/schema.ts';
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

function getSetCookies(res: Response): string[] {
  const h = res.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === 'function') {
    return h.getSetCookie();
  }
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

/**
 * Returns true if the Set-Cookie directive clears the cookie.
 * Hono's deleteCookie sets Max-Age=0 and an empty value.
 */
function isClearedCookie(value: string): boolean {
  return /Max-Age=0/i.test(value) || /Expires=[^;]+19[0-9]{2}/i.test(value);
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('POST /auth.logout — happy path', () => {
  it('returns 200 and clears the session cookie', async () => {
    const agent = await loginPatient();

    const res = await agent.request('/auth.logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...csrfHeaders(agent),
      },
    });

    expect(res.status).toBe(200);

    const cookies = getSetCookies(res);
    const sessionCookie = cookies.find((h) => h.startsWith('session='));
    expect(sessionCookie, 'session cookie clear directive must be present').toBeTruthy();
    expect(
      isClearedCookie(sessionCookie ?? ''),
      `session cookie should be cleared, got: ${sessionCookie}`,
    ).toBe(true);
  });

  it('returns 200 and clears the refresh cookie', async () => {
    const agent = await loginPatient();

    const res = await agent.request('/auth.logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...csrfHeaders(agent),
      },
    });

    expect(res.status).toBe(200);

    const cookies = getSetCookies(res);
    const refreshCookie = cookies.find((h) => h.startsWith('refresh='));
    expect(refreshCookie, 'refresh cookie clear directive must be present').toBeTruthy();
    expect(
      isClearedCookie(refreshCookie ?? ''),
      `refresh cookie should be cleared, got: ${refreshCookie}`,
    ).toBe(true);
  });

  it('revokes the active refresh_token row in the database', async () => {
    const agent = await loginPatient();

    // Confirm one active token exists before logout
    const before = await testDb.db.select().from(refreshToken);
    expect(before).toHaveLength(1);
    expect(before[0]?.revokedAt).toBeNull();

    await agent.request('/auth.logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...csrfHeaders(agent),
      },
    });

    // The row must now be revoked
    const after = await testDb.db.select().from(refreshToken);
    expect(after).toHaveLength(1);
    expect(after[0]?.revokedAt, 'refresh token row must be revoked after logout').not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sad paths
// ---------------------------------------------------------------------------

describe('POST /auth.logout — sad paths', () => {
  it('returns 403 when no CSRF header is present', async () => {
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

  it('returns 401 when no session cookie is present', async () => {
    const agent = createRequestAgent(app);
    // Manually set a csrf_token so CSRF passes, but no session cookie
    agent.cookies().set('csrf_token', 'fake-csrf-token-for-test-12345');

    const res = await agent.request('/auth.logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'fake-csrf-token-for-test-12345',
      },
    });

    expect(res.status).toBe(401);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
