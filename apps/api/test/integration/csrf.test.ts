/**
 * csrf.test.ts — CSRF double-submit middleware integration tests (B6)
 *
 * Confirms that POST /api/logout (a state-changing, non-exempt route) enforces
 * the double-submit CSRF pattern:
 *
 *   Case 1 — missing X-CSRF-Token header          → 403 FORBIDDEN
 *   Case 2 — header value does not match cookie    → 403 FORBIDDEN
 *   Case 3 — header value matches csrf_token cookie → 200
 *
 * NOTE: The CSRF middleware (apps/api/src/middleware/csrf.ts) exempts the paths
 * "/v1/auth/login" and "/v1/auth/refresh".  However, app.ts mounts the auth
 * router at "/api" (not "/v1/auth"), so the runtime paths are "/api/login" and
 * "/api/refresh".  This path mismatch means the login route is NOT exempt in the
 * current production code; a subsequent PR must align the exempt paths or the
 * mount prefix.  Until that fix lands, the loginAs helper call below exercises
 * the mismatch and the test framework surface will report the actual HTTP status
 * if the mismatch causes an unexpected 403 on login.
 *
 * Requires Docker to be running (testcontainers — one container per file).
 */
import { createHash, createSecretKey } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { authn } from '../../src/middleware/authn.js';
import type { UserClaims } from '../../src/modules/auth/index.js';
import { createAuthService } from '../../src/modules/auth/index.js';
import { createLoginThrottle } from '../../src/modules/auth/throttle.js';
import type { Db } from '../../src/shared/db.js';
import { createPasswordVerifier } from '../../src/shared/password.js';
import { expectAppError } from '../support/assertions.js';
import { startPostgres } from '../support/container.js';
import { seedFixtures } from '../support/fixtures.js';
import { buildClient } from '../support/request.js';

// ---------------------------------------------------------------------------
// Module-level state (one container per file)
// ---------------------------------------------------------------------------

const JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!';

let stopContainer: () => Promise<void>;
let db: Db;
let pool: Pool;
let app: ReturnType<typeof createApp>;

// ---------------------------------------------------------------------------
// beforeAll — start Postgres container, run migrations, build app
// ---------------------------------------------------------------------------

beforeAll(async () => {
  process.env['JWT_SECRET'] = JWT_SECRET;

  const postgres = await startPostgres();
  stopContainer = postgres.stop;

  pool = new Pool({ connectionString: postgres.url });
  db = drizzle(pool) as unknown as Db;

  const secretKey = createSecretKey(Buffer.from(JWT_SECRET, 'utf8'));

  async function signSessionJwt(claims: UserClaims): Promise<string> {
    return new SignJWT({
      sub: claims.userId,
      email: claims.email,
      role: claims.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(secretKey);
  }

  function hashRefreshToken(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }

  const throttle = createLoginThrottle();
  const verifyPassword = createPasswordVerifier().verify;

  const service = createAuthService({
    db,
    throttle,
    verifyPassword,
    signSessionJwt,
    hashRefreshToken,
    now: () => new Date(),
    log: { warn: () => undefined },
  });

  app = createApp({ service, authn });
}, 60_000);

// ---------------------------------------------------------------------------
// afterAll — tear down pool and container
// ---------------------------------------------------------------------------

afterAll(async () => {
  await pool.end();
  await stopContainer();
}, 30_000);

// ---------------------------------------------------------------------------
// beforeEach — truncate and re-seed canonical fixtures
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await seedFixtures(db);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CSRF double-submit enforcement on POST /api/logout', () => {
  it('case 1: returns 403 FORBIDDEN when X-CSRF-Token header is absent', async () => {
    const client = buildClient(app);

    // Log in to populate the cookie jar (session + refresh_token + csrf_token).
    const loginRes = await client.loginAs('patient@medbridge.test', 'patientpass123!');
    expect(
      loginRes.status,
      `loginAs failed with status ${loginRes.status.toString()} — check CSRF exempt-path alignment`,
    ).toBe(200);

    // POST /api/logout WITHOUT the X-CSRF-Token header.
    // The csrf_token cookie is present in the jar but no header mirrors it.
    const res = await client.fetch('/api/logout', {
      method: 'POST',
      extraHeaders: {
        'Content-Type': 'application/json',
      },
    });

    await expectAppError(res, 'FORBIDDEN');
  });

  it('case 2: returns 403 FORBIDDEN when X-CSRF-Token header does not match the csrf_token cookie', async () => {
    const client = buildClient(app);

    // Log in to populate the cookie jar.
    const loginRes = await client.loginAs('patient@medbridge.test', 'patientpass123!');
    expect(
      loginRes.status,
      `loginAs failed with status ${loginRes.status.toString()} — check CSRF exempt-path alignment`,
    ).toBe(200);

    // POST /api/logout with an intentionally wrong header value.
    const res = await client.fetch('/api/logout', {
      method: 'POST',
      extraHeaders: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'wrong-value-that-does-not-match-csrf-cookie',
      },
    });

    await expectAppError(res, 'FORBIDDEN');
  });

  it('case 3: returns 200 when X-CSRF-Token header matches the csrf_token cookie', async () => {
    const client = buildClient(app);

    // Log in to populate the cookie jar.
    const loginRes = await client.loginAs('patient@medbridge.test', 'patientpass123!');
    expect(
      loginRes.status,
      `loginAs failed with status ${loginRes.status.toString()} — check CSRF exempt-path alignment`,
    ).toBe(200);

    // csrfPost reads csrf_token from the jar and mirrors it into X-CSRF-Token.
    const res = await client.csrfPost('/api/logout', {});

    expect(res.status).toBe(200);
  });
});
