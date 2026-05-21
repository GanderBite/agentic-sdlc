/**
 * Integration tests: CSRF protection on auth.logout
 *
 * REQUIRES: Docker daemon running on the host (testcontainers).
 *
 * Covers:
 *  - POST /api/auth.logout without X-CSRF-Token header returns 403 FORBIDDEN
 *  - POST /api/auth.logout with mismatched X-CSRF-Token header returns 403 FORBIDDEN
 *  - POST /api/auth.logout with matching X-CSRF-Token header succeeds (200)
 *
 * auth.logout declares per-route `csrf, authn` middleware in routes.ts.
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
// Helper
// ---------------------------------------------------------------------------

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
// CSRF validation on auth.logout
// ---------------------------------------------------------------------------

describe('auth.csrf — auth.logout CSRF protection', () => {
  it('when X-CSRF-Token header is absent but valid session exists, returns 403 FORBIDDEN', async () => {
    // arrange — log in so session + csrf_token cookies are in the agent jar
    await insertSeedUsers(testDb.db);
    await loginAsPatient();

    // act — POST auth.logout WITHOUT the CSRF header
    const res = await agent.fetch('/api/auth.logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      skipCsrf: true, // suppress agent's auto X-CSRF-Token injection
    });

    // assert — per-route csrf middleware rejects with 403 FORBIDDEN
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('when X-CSRF-Token header value does not match the csrf_token cookie, returns 403 FORBIDDEN', async () => {
    // arrange
    await insertSeedUsers(testDb.db);
    await loginAsPatient();

    // act — send a deliberately mismatched CSRF header
    const res = await agent.fetch('/api/auth.logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'this-is-definitely-not-the-real-csrf-token-value',
      },
      skipCsrf: true, // prevent agent from overriding with the correct value
    });

    // assert
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('when X-CSRF-Token header matches the csrf_token cookie, logout succeeds', async () => {
    // arrange
    await insertSeedUsers(testDb.db);
    await loginAsPatient();

    // act — agent auto-injects correct X-CSRF-Token from the cookie jar
    const res = await agent.fetch('/api/auth.logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    // assert — matching CSRF token allows the request through
    expect(res.status).toBe(200);
  });
});
