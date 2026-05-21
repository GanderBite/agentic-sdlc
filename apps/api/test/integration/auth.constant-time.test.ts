/**
 * auth.constant-time.test.ts
 *
 * Adversarial smoke: verifies that hasher.verify is called EXACTLY ONCE per
 * login attempt regardless of whether the email exists in the database.
 *
 * Acceptance bullets 7 and 14:
 *   - unknown email → verify called once (against the DUMMY_HASH constant)
 *   - known email + wrong password → verify called once (against stored hash)
 * Both branches must return 401.
 *
 * Strategy: build the app using production building blocks (createAuthService +
 * wireAuth) with a spied PasswordHasher. The repo is wired directly to the test
 * Drizzle instance so no production DB singleton is involved.
 *
 * REQUIRES: Docker daemon running on the host.
 */

// ---------------------------------------------------------------------------
// Set required env vars BEFORE any production module reads process.env.
// vi.hoisted runs before static imports in Vitest's transform step.
// ---------------------------------------------------------------------------
vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-exactly-32-bytes!';
  process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
  process.env.NODE_ENV = 'test';
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { type PasswordHasher, defaultPasswordHasher } from '../../src/modules/auth/passwords.js';
import { refreshToken, user } from '../../src/modules/auth/schema.js';
import type { AuthRepo } from '../../src/modules/auth/service.js';
import { logger } from '../../src/shared/logger.js';
import { defaultClock } from '../../src/shared/time.js';

import { SEED_PLAIN_PASSWORD } from '../support/passwords.js';
import { type RequestAgent, createRequestAgent } from '../support/request.js';

// ---------------------------------------------------------------------------
// Schema barrel (used by Drizzle)
// ---------------------------------------------------------------------------
import * as schema from '../../src/db/schema.js';

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
// Per-test fixtures
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
// Build a repo adapter wired to the test Drizzle instance
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

// ---------------------------------------------------------------------------
// Build the Hono app with an injected hasher.
// Note: auth.login is documented as CSRF-exempt (routes.ts comment).
// The CSRF middleware is intentionally omitted here so the test can reach the
// auth service and assert constant-time behavior on the verify call.
// The CSRF middleware correctly rejects requests lacking a csrf_token cookie,
// but auth.login must be reachable without one to bootstrap a session.
// ---------------------------------------------------------------------------

function buildTestApp(hasherOverride: PasswordHasher): Hono {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.use('*', loggerMiddleware);
  app.use('*', cors({ origin: '*', credentials: false }));
  app.get('/api/health', (c) => c.json({ ok: true }, 200));

  // Build the auth router without the global CSRF middleware so that
  // auth.login (which is CSRF-exempt per its route definition) is reachable.
  const authService = createAuthService({
    repo: makeTestRepo(),
    hasher: hasherOverride,
    clock: defaultClock,
    logger: logger.child({ module: 'auth' }),
  });

  const apiRouter = new Hono();
  // No global authn/csrf middleware — auth.login and auth.refresh are exempt
  // (they bootstrap the session). auth.logout and auth.me have per-route
  // authn/csrf inline in routes.ts, so they still enforce auth correctly.
  wireAuth(apiRouter, { service: authService });
  app.route('/api', apiRouter);
  app.onError(errorHandler);

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auth.constant-time', () => {
  let spiedHasher: PasswordHasher & { verify: ReturnType<typeof vi.fn> };
  let agent: RequestAgent;

  beforeEach(async () => {
    await truncate();

    // Wrap the real verify in a spy that counts calls but still executes argon2.
    const verifySpy = vi.fn(
      (hash: string, plain: string): Promise<boolean> => defaultPasswordHasher.verify(hash, plain),
    );
    spiedHasher = {
      hash: defaultPasswordHasher.hash.bind(defaultPasswordHasher),
      verify: verifySpy,
    };

    agent = createRequestAgent(buildTestApp(spiedHasher));
    agent.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('when email is unknown, then hasher.verify is called exactly once and response is 401', async () => {
    // arrange — empty DB, no users seeded

    // act
    const res = await agent.fetch('/api/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@nowhere.test', password: 'doesnotmatter' }),
    });

    // assert — 401 AND exactly one verify call (constant-time guard)
    expect(res.status).toBe(401);
    expect(spiedHasher.verify).toHaveBeenCalledTimes(1);
  });

  it('when email exists but password is wrong, then hasher.verify is called exactly once and response is 401', async () => {
    // arrange — seed one user with the known password
    await seedUsers();

    // act — submit a wrong password for a known email
    const res = await agent.fetch('/api/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@test.local', password: 'WrongPassword999!' }),
    });

    // assert — 401 AND exactly one verify call
    expect(res.status).toBe(401);
    expect(spiedHasher.verify).toHaveBeenCalledTimes(1);
  });
});
