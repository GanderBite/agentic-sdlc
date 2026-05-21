/**
 * auth.token-family.test.ts
 *
 * Adversarial smoke: verifies token-family revocation on refresh-token replay.
 *
 * Flow:
 *   1. Login → capture refresh cookie R1.
 *   2. Refresh with R1 → rotates to R2.
 *   3. Replay R1 (now revoked).
 *   4. Assert:
 *      a. Response is 401.
 *      b. SELECT ... WHERE user_id = ? AND revoked_at IS NULL returns 0 rows
 *         (all tokens in the family are revoked).
 *      c. Captured log has exactly one warn line containing the userId.
 *
 * Acceptance bullet 12.
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
import { defaultClock } from '../../src/shared/time.js';

import * as schema from '../../src/db/schema.js';

import { createCapturedLogger, createLogCapture } from '../support/logCapture.js';
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

function makeTestRepo(capturedLogger: ReturnType<typeof createCapturedLogger>): AuthRepo {
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

function buildTestApp(capturedLogger: ReturnType<typeof createCapturedLogger>): Hono {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.use('*', loggerMiddleware);
  app.use('*', cors({ origin: '*', credentials: false }));
  app.get('/api/health', (c) => c.json({ ok: true }, 200));

  const apiRouter = new Hono();
  // No global authn/csrf — auth.login and auth.refresh are exempt.
  // auth.logout and auth.me enforce auth per-route via inline middleware.

  const authService = createAuthService({
    repo: makeTestRepo(capturedLogger),
    hasher: defaultPasswordHasher,
    clock: defaultClock,
    logger: capturedLogger.child({ module: 'auth' }),
  });

  wireAuth(apiRouter, { service: authService });
  app.route('/api', apiRouter);
  app.onError(errorHandler);

  return app;
}

// ---------------------------------------------------------------------------
// Helper: extract a cookie value from a response's Set-Cookie headers
// ---------------------------------------------------------------------------

function extractCookie(res: Response, name: string): string {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const rawCookie of setCookies) {
    const firstPart = rawCookie.split(';')[0] ?? '';
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx === -1) continue;
    const cookieName = firstPart.slice(0, eqIdx).trim();
    const val = firstPart.slice(eqIdx + 1).trim();
    if (cookieName === name) return val;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auth.token-family', () => {
  let capture: ReturnType<typeof createLogCapture>;
  let capturedLogger: ReturnType<typeof createCapturedLogger>;
  let app: Hono;

  beforeEach(async () => {
    await truncate();
    await seedUsers();
    capture = createLogCapture();
    capturedLogger = createCapturedLogger(capture);
    app = buildTestApp(capturedLogger);
  });

  it('when a used refresh token is replayed, then 401 + all user tokens revoked + exactly one warn log containing userId', async () => {
    // arrange — step 1: login to obtain R1
    const loginAgent = createRequestAgent(app);
    const loginRes = await loginAgent.fetch('/api/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@test.local', password: SEED_PLAIN_PASSWORD }),
    });
    expect(loginRes.status).toBe(200);

    const r1Cookie = extractCookie(loginRes, 'refresh');
    const r1Csrf = extractCookie(loginRes, 'csrf_token');
    expect(r1Cookie.length).toBeGreaterThan(0);

    // Lookup the patient userId from the DB.
    const userRows = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, 'patient@test.local'));
    const patientId = userRows[0]?.id ?? '';
    expect(patientId.length).toBeGreaterThan(0);

    // step 2: refresh with R1 → rotates to R2
    const refreshAgent = createRequestAgent(app);
    const refreshRes = await refreshAgent.fetch('/api/auth.refresh', {
      method: 'POST',
      headers: {
        Cookie: `refresh=${r1Cookie}; csrf_token=${r1Csrf}`,
        'Content-Type': 'application/json',
      },
    });
    expect(refreshRes.status).toBe(200);

    // Clear captured logs so only the replay-detection warn line is counted.
    capture.clear();

    // act — step 3: replay the original R1 (now revoked)
    const replayRes = await app.fetch(
      new Request('http://test.local/api/auth.refresh', {
        method: 'POST',
        headers: {
          Cookie: `refresh=${r1Cookie}; csrf_token=${r1Csrf}`,
          'Content-Type': 'application/json',
        },
      }),
    );

    // assert a — response is 401
    expect(replayRes.status).toBe(401);

    // assert b — all refresh tokens for this user are now revoked (0 active)
    const activeTokens = await db
      .select({ id: refreshToken.id })
      .from(refreshToken)
      .where(sql`user_id = ${patientId} AND revoked_at IS NULL`);
    expect(activeTokens).toHaveLength(0);

    // assert c — exactly one warn line in the captured log containing userId
    const warnLines = capture.lines.filter((line) => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        return parsed.level === 40; // pino warn level = 40
      } catch {
        return false;
      }
    });

    expect(warnLines).toHaveLength(1);
    const warnLine = warnLines[0] ?? '';
    expect(warnLine).toContain(patientId);
  });
});
