/**
 * Integration tests: auth.me
 *
 * REQUIRES: Docker daemon running on the host (testcontainers).
 *
 * Covers:
 *  - Valid session cookie returns the seeded user's data (200)
 *  - Missing session cookie returns 401 UNAUTHORIZED
 *  - Invalid/tampered session JWT returns 401 UNAUTHORIZED
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
    throw new Error(`Login failed with status ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auth.me — authenticated access', () => {
  it('when a valid session cookie is present, returns 200 with the seeded user', async () => {
    // arrange — log in to populate the agent cookie jar with a valid session
    await insertSeedUsers(testDb.db);
    await loginAsPatient();

    // act — GET auth.me (GET is CSRF-exempt by definition; auth.me uses per-route authn)
    const res = await agent.fetch('/api/auth.me', { method: 'GET' });

    // assert — status
    expect(res.status).toBe(200);

    // assert — body matches meResponse contract
    const body = (await res.json()) as { user: { id: string; email: string; role: string } };
    expect(body).toMatchObject({
      user: {
        id: expect.any(String),
        email: 'patient@test.local',
        role: 'patient',
      },
    });
  });
});

describe('auth.me — unauthenticated access', () => {
  it('when no session cookie is present, returns 401 UNAUTHORIZED', async () => {
    // arrange — seed users but do NOT log in
    await insertSeedUsers(testDb.db);

    // act
    const res = await agent.fetch('/api/auth.me', { method: 'GET' });

    // assert
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('when the session cookie contains an invalid JWT, returns 401 UNAUTHORIZED', async () => {
    // arrange — inject a malformed JWT directly
    await insertSeedUsers(testDb.db);

    // act
    const res = await agent.fetch('/api/auth.me', {
      method: 'GET',
      headers: { Cookie: 'session=this.is.not.a.valid.jwt' },
    });

    // assert
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
