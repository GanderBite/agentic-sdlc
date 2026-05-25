/**
 * auth.session.test.ts — integration tests for auth.me and auth.logout
 *
 * Covers:
 *   (1) GET /api/me (auth.me): valid session cookie → 200; missing cookie → 401
 *   (2) POST /api/logout (auth.logout): clears cookies + revokes refresh_token row
 *   (3) JWT clock-skew: exp 4s in past → still passes (jose 5s tolerance);
 *       exp 6s in past → 401 UNAUTHORIZED
 *   (4) HS384 ALGORITHM PINNING: same secret, wrong alg → 401 UNAUTHORIZED
 *
 * Docker daemon must be running — this file uses a Postgres testcontainer.
 *
 * NOTE (production bug): The CSRF middleware EXEMPT_PATHS in
 * apps/api/src/middleware/csrf.ts uses "/api/login" and "/api/refresh"
 * but the app mounts routes at "/api/login" and "/api/refresh". This means
 * loginAs() would return 403 FORBIDDEN. All tests in this file work around
 * this by seeding the DB state and cookies directly instead of going through
 * POST /api/login.
 */
import { createHash, createSecretKey } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { authn } from '../../src/middleware/authn.js';
import { createAuthService } from '../../src/modules/auth/index.js';
import { refreshToken as refreshTokenTable } from '../../src/modules/auth/schema.js';
import { createLoginThrottle } from '../../src/modules/auth/throttle.js';
import type { Db } from '../../src/shared/db.js';
import { expectAppError } from '../support/assertions.js';
import { seedFixtures } from '../support/fixtures.js';

// ---------------------------------------------------------------------------
// Module-level paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, '../../src/db/migrations');

// ---------------------------------------------------------------------------
// Shared JWT secret — must match what authn middleware reads from process.env
// ---------------------------------------------------------------------------

const JWT_SECRET = 'x'.repeat(32);

// ---------------------------------------------------------------------------
// Container + app lifecycle (one container per file)
// ---------------------------------------------------------------------------

let container: StartedPostgreSqlContainer;
let pool: Pool;
let db: Db;

let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  // Set JWT_SECRET before building authn middleware (which reads process.env).
  process.env['JWT_SECRET'] = JWT_SECRET;

  // Start Postgres container.
  const builder = new PostgreSqlContainer('postgres:17-alpine');
  if (process.env['CI'] !== 'true') {
    builder.withReuse();
  }
  container = await builder.start();

  const url = container.getConnectionUri();
  pool = new Pool({ connectionString: url });
  db = drizzle(pool) as unknown as Db;

  // Apply production migrations.
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  // Wire auth service deps (same pattern as main.ts).
  const secretKey = createSecretKey(Buffer.from(JWT_SECRET, 'utf8'));

  async function signSessionJwt(claims: {
    userId: string;
    email: string;
    role: 'patient' | 'doctor';
  }): Promise<string> {
    return new SignJWT({ sub: claims.userId, email: claims.email, role: claims.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(secretKey);
  }

  function hashRefreshToken(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }

  const throttle = createLoginThrottle();
  const now = (): Date => new Date();

  const service = createAuthService({
    db,
    throttle,
    verifyPassword: async (_hash: string, _plain: string) => true,
    signSessionJwt,
    hashRefreshToken,
    now,
    log: { warn: () => undefined },
  });

  app = createApp({ service, authn });
}, 60_000);

afterAll(async () => {
  await pool.end();
  await container.stop();
}, 30_000);

afterEach(async () => {
  await pool.query('TRUNCATE TABLE refresh_token, "user" RESTART IDENTITY CASCADE');
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mint a valid HS256 session JWT (same algo + secret as authn middleware). */
async function mintSessionJwt(claims: {
  sub: string;
  email: string;
  role: string;
  expOffsetSeconds?: number;
}): Promise<string> {
  const secretKey = createSecretKey(Buffer.from(JWT_SECRET, 'utf8'));
  const builder = new SignJWT({ sub: claims.sub, email: claims.email, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt();

  if (claims.expOffsetSeconds !== undefined) {
    // Set exp manually: Math.floor(Date.now()/1000) + offset (negative = past)
    builder.setExpirationTime(Math.floor(Date.now() / 1000) + claims.expOffsetSeconds);
  } else {
    builder.setExpirationTime('15m');
  }

  return builder.sign(secretKey);
}

/** Make a GET /api/me request with the given session cookie value. */
async function getMeWithCookie(sessionValue: string): Promise<Response> {
  const url = 'http://test.local/api/me';
  const req = new Request(url, {
    method: 'GET',
    headers: { Cookie: `session=${sessionValue}` },
  });
  return app.fetch(req);
}

/** Hash a raw refresh token value (same logic as main.ts). */
function hashRefreshToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/** Insert a refresh_token row directly, bypassing the service layer. */
async function insertRefreshTokenRow(userId: string, rawToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(refreshTokenTable).values({ userId, tokenHash, expiresAt }).returning();
}

// ---------------------------------------------------------------------------
// (1) auth.me — GET /api/me
// ---------------------------------------------------------------------------

describe('auth.me — GET /api/me', () => {
  it('returns 200 with current user when session cookie is valid', async () => {
    // Seed a patient user.
    const { patient } = await seedFixtures(db);

    // Mint a valid JWT for that user.
    const jwt = await mintSessionJwt({
      sub: patient.id,
      email: patient.email,
      role: patient.role,
    });

    const res = await getMeWithCookie(jwt);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string; email: string; role: string } };
    expect(body.user.id).toBe(patient.id);
    expect(body.user.email).toBe(patient.email);
    expect(body.user.role).toBe('patient');
  });

  it('returns 401 UNAUTHORIZED when session cookie is absent', async () => {
    const url = 'http://test.local/api/me';
    const req = new Request(url, { method: 'GET' });
    const res = await app.fetch(req);
    await expectAppError(res, 'UNAUTHORIZED');
  });
});

// ---------------------------------------------------------------------------
// (2) auth.logout — POST /api/logout
// ---------------------------------------------------------------------------

describe('auth.logout — POST /api/logout', () => {
  it('clears all three auth cookies and revokes the refresh_token row', async () => {
    // Seed a user.
    const { patient } = await seedFixtures(db);

    // Mint a session JWT and generate a raw refresh token.
    const jwt = await mintSessionJwt({
      sub: patient.id,
      email: patient.email,
      role: patient.role,
    });
    const rawRefreshToken = 'test-refresh-token-for-logout-case-abc123';

    // Insert refresh_token row directly (bypasses login CSRF bug).
    await insertRefreshTokenRow(patient.id, rawRefreshToken);

    // Call app.fetch() directly with all three cookies and the X-CSRF-Token header.
    // The CSRF double-submit requires cookie value == header value.
    const csrfToken = 'csrf-test-token-xyz';

    const logoutReq = new Request('http://test.local/api/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session=${jwt}; refresh_token=${rawRefreshToken}; csrf_token=${csrfToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({}),
    });

    const res = await app.fetch(logoutReq);

    expect(res.status).toBe(200);

    // Assert Set-Cookie clears session, refresh_token, and csrf_token (Max-Age=0).
    const setCookieHeaders = res.headers.getSetCookie
      ? res.headers.getSetCookie()
      : (() => {
          const values: string[] = [];
          res.headers.forEach((v, k) => {
            if (k.toLowerCase() === 'set-cookie') values.push(v);
          });
          return values;
        })();

    const cookieNames = setCookieHeaders.map((h) => h.split('=')[0]?.trim() ?? '');

    expect(cookieNames).toContain('session');
    expect(cookieNames).toContain('refresh_token');
    expect(cookieNames).toContain('csrf_token');

    // All three should have Max-Age=0 (deletion signal).
    for (const h of setCookieHeaders) {
      const namePart = h.split('=')[0]?.trim() ?? '';
      if (namePart === 'session' || namePart === 'refresh_token' || namePart === 'csrf_token') {
        expect(h.toLowerCase()).toMatch(/max-age=0/);
      }
    }

    // Assert refresh_token row has revoked_at IS NOT NULL.
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const rows = await db
      .select()
      .from(refreshTokenTable)
      .where(eq(refreshTokenTable.tokenHash, tokenHash));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toBeDefined();
    expect(rows[0]?.revokedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (3) JWT clock-skew
// ---------------------------------------------------------------------------

describe('auth.me — JWT clock-skew (exp tolerance)', () => {
  it('accepts a token with exp 4 seconds in the past (jose 5s tolerance per B12)', async () => {
    const { patient } = await seedFixtures(db);

    // exp = now - 4s (within jose's default 5s clockTolerance)
    const jwt = await mintSessionJwt({
      sub: patient.id,
      email: patient.email,
      role: patient.role,
      expOffsetSeconds: -4,
    });

    const res = await getMeWithCookie(jwt);

    // Should still pass: jose 5-second clock tolerance allows this
    expect(res.status).toBe(200);
  });

  it('rejects a token with exp 6 seconds in the past (beyond jose 5s tolerance)', async () => {
    const { patient } = await seedFixtures(db);

    // exp = now - 6s (exceeds jose's 5s clockTolerance)
    const jwt = await mintSessionJwt({
      sub: patient.id,
      email: patient.email,
      role: patient.role,
      expOffsetSeconds: -6,
    });

    const res = await getMeWithCookie(jwt);

    await expectAppError(res, 'UNAUTHORIZED');
  });
});

// ---------------------------------------------------------------------------
// (4) HS384 ALGORITHM PINNING
// ---------------------------------------------------------------------------

describe('auth.me — HS384 algorithm pinning (auth.me security smoke)', () => {
  it('rejects a token signed with HS384 even when the secret is correct', async () => {
    const { patient } = await seedFixtures(db);

    // Mint with HS384 using the SAME secret — authn pins to HS256 only.
    const secretKey = createSecretKey(Buffer.from(JWT_SECRET, 'utf8'));
    const hs384Jwt = await new SignJWT({
      sub: patient.id,
      email: patient.email,
      role: patient.role,
    })
      .setProtectedHeader({ alg: 'HS384' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(secretKey);

    const res = await getMeWithCookie(hs384Jwt);

    // The authn middleware uses algorithms: ['HS256'] so HS384 must be rejected.
    await expectAppError(res, 'UNAUTHORIZED');
  });
});
