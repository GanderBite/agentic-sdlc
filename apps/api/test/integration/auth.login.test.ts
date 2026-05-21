/**
 * Integration tests: auth.login
 *
 * REQUIRES: Docker daemon running on the host (testcontainers).
 *
 * Covers:
 *  - Happy path: 200 + { user: { id, email, role } } body
 *    + HttpOnly session cookie + HttpOnly refresh cookie
 *    + non-HttpOnly csrf_token cookie
 *  - Sad path — unknown email: 401 + { error: { code: 'UNAUTHORIZED' } } + zero Set-Cookie
 *  - Sad path — wrong password:  401 + { error: { code: 'UNAUTHORIZED' } } + zero Set-Cookie
 */

import type { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type TestDb, startPostgresContainer } from '../support/db.ts';
import { insertSeedUsers, truncate } from '../support/fixtures.ts';
import { SEED_PLAIN_PASSWORD } from '../support/passwords.ts';
import { type RequestAgent, createRequestAgent } from '../support/request.ts';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let testDb: TestDb;
let agent: RequestAgent;

// ---------------------------------------------------------------------------
// Lifecycle: one container per file (testcontainers rule)
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Start container first so we have the connection URI before importing
  // any module that reads process.env.DATABASE_URL at load time.
  testDb = await startPostgresContainer();

  // Set env vars BEFORE dynamically importing modules that read them.
  process.env.DATABASE_URL = testDb.container.getConnectionUri();
  process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes-long!!';
  process.env.NODE_ENV = 'test';

  // Dynamic import after env is set so db/client.ts and env.ts see correct values.
  // buildTestApp() mirrors buildApp() from src/main.ts — exercises the
  // real production middleware composition.
  const { buildTestApp } = await import('../support/app.js');
  const app: Hono = await buildTestApp();

  agent = createRequestAgent(app);
}, 60_000);

afterAll(async () => {
  // Close the production pool before stopping the container to avoid
  // "terminating connection" unhandled errors from open pg connections.
  const { closeDb } = await import('../../src/db/client.js');
  await closeDb();
  await testDb.pool.end();
  await testDb.container.stop();
}, 30_000);

beforeEach(async () => {
  await truncate(testDb.pool);
  agent.reset();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSetCookies(res: Response): string[] {
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie();
  }
  const raw = res.headers.get('set-cookie') ?? '';
  return raw.length > 0 ? raw.split(',').filter(Boolean) : [];
}

function cookieHasAttribute(setCookieHeader: string, attr: string): boolean {
  return setCookieHeader
    .split(';')
    .slice(1)
    .some((p) => p.trim().toLowerCase() === attr.toLowerCase());
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('auth.login — happy path', () => {
  it('when valid credentials are supplied, returns 200 with user body and three auth cookies', async () => {
    // arrange
    await insertSeedUsers(testDb.db);

    // act
    const res = await agent.fetch('/api/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@test.local', password: SEED_PLAIN_PASSWORD }),
    });

    // assert — status
    expect(res.status).toBe(200);

    // assert — body shape matches loginResponse contract
    const body = (await res.json()) as { user: { id: string; email: string; role: string } };
    expect(body).toMatchObject({
      user: {
        id: expect.any(String),
        email: 'patient@test.local',
        role: 'patient',
      },
    });

    // assert — all three auth cookies are present
    const cookies = getSetCookies(res);
    const sessionHeader = cookies.find((h) => h.trimStart().startsWith('session='));
    const refreshHeader = cookies.find((h) => h.trimStart().startsWith('refresh='));
    const csrfHeader = cookies.find((h) => h.trimStart().startsWith('csrf_token='));

    expect(sessionHeader).toBeDefined();
    expect(refreshHeader).toBeDefined();
    expect(csrfHeader).toBeDefined();

    // assert — session cookie is HttpOnly (security requirement: ARCHITECTURE §5.4)
    expect(cookieHasAttribute(sessionHeader ?? '', 'HttpOnly')).toBe(true);

    // assert — refresh cookie is HttpOnly
    expect(cookieHasAttribute(refreshHeader ?? '', 'HttpOnly')).toBe(true);

    // assert — csrf_token is NOT HttpOnly so the SPA can read it for the double-submit pattern
    expect(cookieHasAttribute(csrfHeader ?? '', 'HttpOnly')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sad paths
// ---------------------------------------------------------------------------

describe('auth.login — sad paths', () => {
  it('when email does not exist, returns 401 UNAUTHORIZED with zero Set-Cookie headers', async () => {
    // arrange
    await insertSeedUsers(testDb.db);

    // act
    const res = await agent.fetch('/api/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@test.local', password: SEED_PLAIN_PASSWORD }),
    });

    // assert
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');

    // no cookies set on auth failure
    const cookies = getSetCookies(res);
    expect(cookies).toHaveLength(0);
  });

  it('when password is incorrect, returns 401 UNAUTHORIZED with zero Set-Cookie headers', async () => {
    // arrange
    await insertSeedUsers(testDb.db);

    // act
    const res = await agent.fetch('/api/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@test.local', password: 'WrongPassword999!' }),
    });

    // assert
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');

    const cookies = getSetCookies(res);
    expect(cookies).toHaveLength(0);
  });
});
