/**
 * auth.concurrent-refresh.test.ts
 *
 * Adversarial smoke: verifies that two concurrent POST /auth.refresh requests
 * carrying the same refresh cookie result in exactly one 200 (token rotated)
 * and one 401 (token already consumed), never two 200s.
 *
 * The atomicity guarantee comes from the UPDATE...WHERE revoked_at IS NULL
 * RETURNING statement in repo.rotateRefreshToken — only one UPDATE will win
 * the race even under concurrent execution.
 *
 * Acceptance bullet 11.
 *
 * REQUIRES: Docker daemon running on the host.
 */

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-exactly-32-bytes!';
  process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
  process.env.NODE_ENV = 'test';
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { type NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { errorHandler } from '../../src/middleware/errorHandler.js';
import { logger as loggerMiddleware } from '../../src/middleware/logger.js';
import { requestId as requestIdMiddleware } from '../../src/middleware/requestId.js';
import { createAuthService, wireAuth } from '../../src/modules/auth/index.js';
import { defaultPasswordHasher } from '../../src/modules/auth/passwords.js';
import { refreshToken, user } from '../../src/modules/auth/schema.js';
import type { AuthRepo } from '../../src/modules/auth/service.js';
import { logger } from '../../src/shared/logger.js';
import { defaultClock } from '../../src/shared/time.js';

import * as schema from '../../src/db/schema.js';

import { SEED_PLAIN_PASSWORD } from '../support/passwords.js';
import { createRequestAgent } from '../support/request.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(__dirname, '../../src/db/migrations');

// ---------------------------------------------------------------------------
// One container per file
// ---------------------------------------------------------------------------

let container: StartedPostgreSqlContainer;
let pool: Pool;
let db: NodePgDatabase<typeof schema>;

beforeAll(async () => {
  const builder = new PostgreSqlContainer('postgres:17-alpine');

  container = await builder.start();
  pool = new Pool({ connectionString: container.getConnectionUri(), max: 5 });
  db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
}, 60_000);

afterAll(async () => {
  await pool.end();
  await container.stop();
}, 30_000);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function seedUsers(): Promise<void> {
  const hash = await defaultPasswordHasher.hash(SEED_PLAIN_PASSWORD);
  await db.insert(user).values([
    { email: 'patient@test.local', role: 'patient', passwordHash: hash },
    { email: 'doctor@test.local', role: 'doctor', passwordHash: hash },
  ]);
}

async function truncate(): Promise<void> {
  await pool.query('TRUNCATE TABLE refresh_token, "user" RESTART IDENTITY CASCADE');
}

// ---------------------------------------------------------------------------
// Test-pool repo adapter
// ---------------------------------------------------------------------------

function makeTestRepo(): AuthRepo {
  return {
    async findUserByEmail(email) {
      const rows = await db.select().from(user).where(eq(user.email, email)).limit(1);
      const first = rows[0];
      if (first === undefined || first.deletedAt !== null) return undefined;
      return first;
    },
    async findUserById(id) {
      const rows = await db.select().from(user).where(eq(user.id, id)).limit(1);
      const first = rows[0];
      if (first === undefined || first.deletedAt !== null) return undefined;
      return first;
    },
    async insertRefreshToken(input) {
      const rows = await db
        .insert(refreshToken)
        .values({ userId: input.userId, hash: input.hash, expiresAt: input.expiresAt })
        .returning();
      const row = rows[0];
      if (row === undefined) throw new Error('insertRefreshToken: no row returned');
      return row;
    },
    async rotateRefreshToken(hash) {
      const result = await db.execute<{ id: string; user_id: string; expires_at: Date }>(
        sql`UPDATE refresh_token SET revoked_at = now() WHERE hash = ${hash} AND revoked_at IS NULL RETURNING id, user_id, expires_at`,
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      return { id: row.id, userId: row.user_id, expiresAt: row.expires_at };
    },
    async findRefreshTokenAnywhere(hash) {
      const rows = await db.select().from(refreshToken).where(eq(refreshToken.hash, hash)).limit(1);
      return rows[0];
    },
    async revokeAllActiveForUser(userId) {
      await db.execute(
        sql`UPDATE refresh_token SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`,
      );
    },
  };
}

function buildTestApp(): Hono {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.use('*', loggerMiddleware);
  app.use('*', cors({ origin: '*', credentials: false }));
  app.get('/api/health', (c) => c.json({ ok: true }, 200));

  const apiRouter = new Hono();
  // No global authn/csrf — auth.refresh is exempt (rotates session).
  // auth.logout enforces auth per-route via inline middleware in routes.ts.

  const authService = createAuthService({
    repo: makeTestRepo(),
    hasher: defaultPasswordHasher,
    clock: defaultClock,
    logger: logger.child({ module: 'auth' }),
  });

  wireAuth(apiRouter, { service: authService });
  app.route('/api', apiRouter);
  app.onError(errorHandler);

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auth.concurrent-refresh', () => {
  beforeEach(async () => {
    await truncate();
    await seedUsers();
  });

  it('when two concurrent refresh requests carry the same cookie, then exactly one resolves 200 and the other resolves 401', async () => {
    // arrange — login to obtain a refresh cookie
    const app = buildTestApp();
    const loginAgent = createRequestAgent(app);

    const loginRes = await loginAgent.fetch('/api/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@test.local', password: SEED_PLAIN_PASSWORD }),
    });
    expect(loginRes.status).toBe(200);

    // Extract the raw refresh and csrf cookies from the login response.
    const setCookies = loginRes.headers.getSetCookie?.() ?? [];
    let rawRefreshCookie = '';
    let rawCsrfCookie = '';

    for (const rawCookie of setCookies) {
      const firstPart = rawCookie.split(';')[0] ?? '';
      const eqIdx = firstPart.indexOf('=');
      if (eqIdx === -1) continue;
      const name = firstPart.slice(0, eqIdx).trim();
      const val = firstPart.slice(eqIdx + 1).trim();
      if (name === 'refresh') rawRefreshCookie = val;
      if (name === 'csrf_token') rawCsrfCookie = val;
    }

    expect(rawRefreshCookie.length).toBeGreaterThan(0);

    // Both concurrent requests send the EXACT SAME refresh cookie.
    const sharedCookieHeader = `refresh=${rawRefreshCookie}; csrf_token=${rawCsrfCookie}`;

    // act — fire both refresh requests simultaneously
    const [res1, res2] = await Promise.all([
      app.fetch(
        new Request('http://test.local/api/auth.refresh', {
          method: 'POST',
          headers: {
            Cookie: sharedCookieHeader,
            'Content-Type': 'application/json',
          },
        }),
      ),
      app.fetch(
        new Request('http://test.local/api/auth.refresh', {
          method: 'POST',
          headers: {
            Cookie: sharedCookieHeader,
            'Content-Type': 'application/json',
          },
        }),
      ),
    ]);

    const statuses = [res1.status, res2.status].sort((a, b) => a - b);

    // assert — exactly one 200 and one 401; never two 200s
    expect(statuses).toEqual([200, 401]);
  });
});
