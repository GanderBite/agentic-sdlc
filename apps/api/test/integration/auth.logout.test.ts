/**
 * Integration tests: auth.logout
 *
 * REQUIRES: Docker daemon running on the host (testcontainers).
 *
 * Covers:
 *  - Happy path: 200; session and refresh cookies are cleared (Max-Age=0);
 *    the active refresh_token row is revoked in the database.
 *  - Missing auth: 403 (CSRF) or 401 (authn) when no session/csrf cookies.
 */

import { eq } from 'drizzle-orm';
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
// Lifecycle: one container per file
// ---------------------------------------------------------------------------

beforeAll(async () => {
  testDb = await startPostgresContainer();

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

function extractCookieValue(res: Response, name: string): string | undefined {
  const headers =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ?? '').split(',').filter(Boolean);

  const header = headers.find((h) => h.trimStart().startsWith(`${name}=`));
  if (!header) return undefined;
  const firstSemi = header.indexOf(';');
  const pair = firstSemi === -1 ? header : header.slice(0, firstSemi);
  const eqIdx = pair.indexOf('=');
  return eqIdx === -1 ? undefined : pair.slice(eqIdx + 1).trim();
}

function getSetCookies(res: Response): string[] {
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie();
  }
  const raw = res.headers.get('set-cookie') ?? '';
  return raw.length > 0 ? raw.split(',').filter(Boolean) : [];
}

/** Returns true when the Set-Cookie directive contains Max-Age=0 (cookie cleared). */
function isCookieCleared(header: string): boolean {
  return header.split(';').some((p) => p.trim().toLowerCase() === 'max-age=0');
}

async function loginAsPatient(): Promise<void> {
  const res = await agent.fetch('/api/auth.login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'patient@test.local', password: SEED_PLAIN_PASSWORD }),
  });
  if (res.status !== 200) {
    throw new Error(`Login failed: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auth.logout — happy path', () => {
  it('when authenticated, returns 200 and clears session + refresh cookies', async () => {
    // arrange
    await insertSeedUsers(testDb.db);
    await loginAsPatient();

    // act — agent auto-injects X-CSRF-Token from the csrf_token cookie
    const res = await agent.fetch('/api/auth.logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    // assert — status
    expect(res.status).toBe(200);

    // assert — session and refresh cookies are cleared (Max-Age=0)
    const cookies = getSetCookies(res);
    const sessionHeader = cookies.find((h) => h.trimStart().startsWith('session='));
    const refreshHeader = cookies.find((h) => h.trimStart().startsWith('refresh='));

    expect(sessionHeader).toBeDefined();
    expect(refreshHeader).toBeDefined();
    expect(isCookieCleared(sessionHeader ?? '')).toBe(true);
    expect(isCookieCleared(refreshHeader ?? '')).toBe(true);
  });

  it('when authenticated, the active refresh_token row is revoked in the database', async () => {
    // arrange — log in and capture the refresh token value before logout
    await insertSeedUsers(testDb.db);

    const loginRes = await agent.fetch('/api/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@test.local', password: SEED_PLAIN_PASSWORD }),
    });
    expect(loginRes.status).toBe(200);
    const refreshValue = extractCookieValue(loginRes, 'refresh');
    expect(refreshValue).toBeDefined();

    const { refreshToken } = await import('../../src/db/schema.js');
    const { hashRefreshToken } = await import('../../src/modules/auth/tokens.js');
    const hash = await hashRefreshToken(refreshValue ?? '');

    // Confirm the row is active before logout
    const beforeRows = await testDb.db
      .select()
      .from(refreshToken)
      .where(eq(refreshToken.hash, hash));
    expect(beforeRows[0]?.revokedAt).toBeNull();

    // act — logout (agent has session + csrf_token cookies from login)
    const logoutRes = await agent.fetch('/api/auth.logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(logoutRes.status).toBe(200);

    // assert — row now has revoked_at set
    const afterRows = await testDb.db
      .select()
      .from(refreshToken)
      .where(eq(refreshToken.hash, hash));
    expect(afterRows[0]?.revokedAt).not.toBeNull();
  });
});

describe('auth.logout — unauthenticated', () => {
  it('when no session cookie is present, returns a non-2xx error response', async () => {
    // arrange — do NOT log in
    await insertSeedUsers(testDb.db);

    // act — POST logout without session or csrf_token cookies
    // auth.logout route has per-route `csrf, authn` middleware (routes.ts)
    const res = await agent.fetch('/api/auth.logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      skipCsrf: true, // no csrf_token cookie in jar, so no header to inject
    });

    // assert — either 401 (authn) or 403 (csrf) is an acceptable rejection
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(['UNAUTHORIZED', 'FORBIDDEN']).toContain(body.error.code);
  });
});
