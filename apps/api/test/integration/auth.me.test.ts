/**
 * Integration tests — GET /auth.me
 *
 * Validates that a valid session cookie returns the current user,
 * and that missing or tampered session cookies return 401.
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

/** Login and return an agent with session/refresh/csrf cookies. */
async function loginAs(email: string): Promise<ReturnType<typeof createRequestAgent>> {
  const agent = createRequestAgent(app);
  const res = await agent.request('/auth.login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: SEED_PLAINTEXT }),
  });
  if (res.status !== 200) {
    throw new Error(`loginAs(${email}) failed with status ${res.status}`);
  }
  return agent;
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('GET /auth.me — happy path', () => {
  it('returns 200 with the seeded patient user', async () => {
    const agent = await loginAs('patient@seed.test');

    const res = await agent.request('/auth.me', { method: 'GET' });

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      user: { id: string; email: string; role: string };
    };
    expect(body.user).toMatchObject({
      email: 'patient@seed.test',
      role: 'patient',
    });
    expect(typeof body.user.id).toBe('string');
  });

  it('returns 200 with the seeded doctor user', async () => {
    const agent = await loginAs('doctor@seed.test');

    const res = await agent.request('/auth.me', { method: 'GET' });

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      user: { id: string; email: string; role: string };
    };
    expect(body.user).toMatchObject({
      email: 'doctor@seed.test',
      role: 'doctor',
    });
  });
});

// ---------------------------------------------------------------------------
// Sad paths — 401
// ---------------------------------------------------------------------------

describe('GET /auth.me — sad paths', () => {
  it('returns 401 when no session cookie is present', async () => {
    const agent = createRequestAgent(app);

    const res = await agent.request('/auth.me', { method: 'GET' });

    expect(res.status).toBe(401);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when the session cookie contains an invalid JWT', async () => {
    const agent = createRequestAgent(app);

    // Manually inject a bogus session cookie
    agent.cookies().set('session', 'this.is.not.a.valid.jwt');

    const res = await agent.request('/auth.me', { method: 'GET' });

    expect(res.status).toBe(401);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when the session cookie is signed with a wrong secret', async () => {
    const agent = createRequestAgent(app);

    // A structurally valid HS256 JWT but signed with a different secret key.
    // Produced by: SignJWT({userId:'x',role:'patient'}).setProtectedHeader({alg:'HS256'}).sign(wrongKey)
    const forgedJwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4Iiwicm9sZSI6InBhdGllbnQifQ.Qh9FxBwmqL-RkYrk3wPJqZxYLRBLvCcXMaDgFJrk3Vw';
    agent.cookies().set('session', forgedJwt);

    const res = await agent.request('/auth.me', { method: 'GET' });

    expect(res.status).toBe(401);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
