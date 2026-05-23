/**
 * auth.login integration test suite
 *
 * Tests the POST /api/login endpoint (auth.login) against a real ephemeral
 * Postgres container. One testcontainer per file (ARCHITECTURE §8).
 *
 * Cases covered:
 *   1. Valid seeded credentials → 200 + user body + correct cookies
 *   2. Wrong password → 401 UNAUTHORIZED + zero cookies
 *   3. Unknown email → 401 UNAUTHORIZED + verify spy invoked exactly once
 *      (constant-time path per B7/B13)
 *   4. Wrong-password case also asserts verify spy count === 1 (per B13)
 *   5. Per-(IP, email) throttle: 11 requests → first 10 reach verify, 11th → 429
 *   6. Different-email-same-IP NOT throttled after the 11th 429
 *   7. Case-insensitive email throttle: mixed-case repeats share the counter
 *
 * Requires Docker daemon running on the host.
 */
import { createHash, createSecretKey } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { authn } from '../../src/middleware/authn.js';
import type { UserClaims } from '../../src/modules/auth/index.js';
import { createAuthService } from '../../src/modules/auth/index.js';
import { createLoginThrottle } from '../../src/modules/auth/throttle.js';
// Production password module — spy target for verifyPassword (F-001: must use
// the production module path, NOT the test/support/passwords.ts wrapper).
import * as prodPassword from '../../src/shared/password.js';
import { expectAppError } from '../support/assertions.js';
import { startPostgres } from '../support/container.js';
import { seedFixtures } from '../support/fixtures.js';
import { buildClient } from '../support/request.js';

// ---------------------------------------------------------------------------
// Container / app setup (one container per file)
// ---------------------------------------------------------------------------

/** Stable 32-char JWT secret for this test file. */
const TEST_JWT_SECRET = 'integration-test-secret-32chars!!';

let stopContainer: () => Promise<void>;
let pool: Pool;

// Re-created per test (fresh throttle state per test).
let client: ReturnType<typeof buildClient>;

/** Build a fresh Hono app with a fresh throttle instance. */
function buildApp(): ReturnType<typeof createApp> {
  const secretKey = createSecretKey(Buffer.from(TEST_JWT_SECRET, 'utf8'));

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
  const verifyPassword = prodPassword.verify;
  const now = (): Date => new Date();

  const db = drizzle(pool);

  const service = createAuthService({
    db,
    throttle,
    verifyPassword,
    signSessionJwt,
    hashRefreshToken,
    now,
    log: {
      warn: (_bindings: Record<string, unknown>, _msg: string): void => {
        // no-op in tests — pino logger not needed
      },
    },
  });

  return createApp({ service, authn });
}

beforeAll(async () => {
  // Set JWT_SECRET before any module that reads it lazily (authn middleware).
  process.env['JWT_SECRET'] = TEST_JWT_SECRET;

  const { url, stop } = await startPostgres();

  stopContainer = stop;
  pool = new Pool({ connectionString: url });
}, 60_000);

afterAll(async () => {
  await pool.end();
  await stopContainer();
});

beforeEach(async () => {
  // Rebuild app (and thus throttle) for each test to avoid cross-test
  // throttle state leakage.
  const app = buildApp();
  client = buildClient(app);
  // Truncate and re-seed canonical fixture users.
  const db = drizzle(pool);
  await seedFixtures(db);
  client.resetJar();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract Set-Cookie headers from a Response as a flat string array. */
function getCookieHeaders(res: Response): string[] {
  // getSetCookie() is the standard Web API method (Node 18+).
  if (typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function') {
    return (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie();
  }
  const result: string[] = [];
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      result.push(value);
    }
  });
  return result;
}

// ---------------------------------------------------------------------------
// Test suite — auth.login
// ---------------------------------------------------------------------------

describe('auth.login — POST /api/login', () => {
  // -------------------------------------------------------------------------
  // Case 1: valid seeded credentials → 200 + user body + correct cookies
  // -------------------------------------------------------------------------
  it('returns 200 with user body and sets HttpOnly session, refresh_token, and non-HttpOnly csrf_token cookies on valid credentials', async () => {
    const res = await client.loginAs('patient@medbridge.test', 'patientpass123!');

    expect(res.status).toBe(200);

    const body: unknown = await res.json();
    expect(body).toMatchObject({
      user: {
        id: expect.any(String),
        email: 'patient@medbridge.test',
        role: 'patient',
      },
    });

    const setCookies = getCookieHeaders(res);
    expect(setCookies.length).toBeGreaterThanOrEqual(3);

    // Assert session cookie: HttpOnly + Secure
    const sessionCookie = setCookies.find((c) => c.startsWith('session='));
    expect(sessionCookie, 'session cookie should be present').toBeDefined();
    expect(sessionCookie?.toLowerCase()).toContain('httponly');
    expect(sessionCookie?.toLowerCase()).toContain('secure');

    // Assert refresh_token cookie: HttpOnly + Secure
    const refreshCookie = setCookies.find((c) => c.startsWith('refresh_token='));
    expect(refreshCookie, 'refresh_token cookie should be present').toBeDefined();
    expect(refreshCookie?.toLowerCase()).toContain('httponly');
    expect(refreshCookie?.toLowerCase()).toContain('secure');

    // Assert csrf_token cookie: NOT HttpOnly (browser JS must read it)
    const csrfCookie = setCookies.find((c) => c.startsWith('csrf_token='));
    expect(csrfCookie, 'csrf_token cookie should be present').toBeDefined();
    expect(csrfCookie?.toLowerCase()).not.toContain('httponly');
    expect(csrfCookie?.toLowerCase()).toContain('secure');
  });

  // -------------------------------------------------------------------------
  // Case 2: wrong password → 401 UNAUTHORIZED + zero cookies
  // -------------------------------------------------------------------------
  it('returns 401 UNAUTHORIZED with no cookies when the password is wrong', async () => {
    const res = await client.loginAs('patient@medbridge.test', 'WRONG_PASSWORD');

    await expectAppError(res, 'UNAUTHORIZED');

    const setCookies = getCookieHeaders(res);
    // No auth cookies should be set on a failed login
    const authCookieNames = ['session', 'refresh_token', 'csrf_token'];
    for (const name of authCookieNames) {
      const found = setCookies.find((c) => c.startsWith(`${name}=`));
      expect(found, `${name} cookie should NOT be set on failed login`).toBeUndefined();
    }
  });

  // -------------------------------------------------------------------------
  // Case 3: unknown email → 401 + verify spy called exactly once (B7/B13)
  // -------------------------------------------------------------------------
  it('returns 401 UNAUTHORIZED for unknown email and invokes verify exactly once (constant-time path)', async () => {
    const verifySpy = vi.spyOn(prodPassword, 'verify');

    const res = await client.loginAs('nonexistent@medbridge.test', 'any-password');

    await expectAppError(res, 'UNAUTHORIZED');

    // B7: even for unknown email, verifyPassword MUST be called once (dummy hash path)
    expect(verifySpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Case 4: wrong-password case also asserts verify spy count === 1 (B13)
  // -------------------------------------------------------------------------
  it('invokes verify exactly once when the password is wrong (B13 constant-time)', async () => {
    const verifySpy = vi.spyOn(prodPassword, 'verify');

    const res = await client.loginAs('patient@medbridge.test', 'WRONG_PASSWORD');

    await expectAppError(res, 'UNAUTHORIZED');

    expect(verifySpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Case 5: throttle — 11 requests with same IP + same email
  //   first 10 reach verify (spy count === 10)
  //   11th returns 429 TOO_MANY_REQUESTS + verify NOT called
  // -------------------------------------------------------------------------
  it('throttles after 10 failed logins from the same IP and email (rolling window)', async () => {
    const verifySpy = vi.spyOn(prodPassword, 'verify');

    const ip = '203.0.113.42';
    const email = 'patient@medbridge.test';

    // Fire 10 requests — all should pass the throttle gate and reach verify
    for (let i = 0; i < 10; i++) {
      const res = await client.fetch('/api/login', {
        method: 'POST',
        extraHeaders: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ email, password: 'WRONG_PASSWORD' }),
      });
      // Each should return 401 (bad password), NOT 429
      expect(res.status, `request ${i + 1} should be 401, not 429`).toBe(401);
    }

    // After 10 attempts, verify spy should have been called exactly 10 times
    expect(verifySpy).toHaveBeenCalledTimes(10);

    // 11th request — must be throttled before reaching verify
    const eleventhRes = await client.fetch('/api/login', {
      method: 'POST',
      extraHeaders: {
        'Content-Type': 'application/json',
        'x-forwarded-for': ip,
      },
      body: JSON.stringify({ email, password: 'WRONG_PASSWORD' }),
    });

    await expectAppError(eleventhRes, 'TOO_MANY_REQUESTS');

    // verify must NOT have been called the 11th time (still 10)
    expect(verifySpy).toHaveBeenCalledTimes(10);
  });

  // -------------------------------------------------------------------------
  // Case 6: different-email-same-IP NOT throttled
  //   After case-5-style exhaustion, a different email from the same IP goes through
  // -------------------------------------------------------------------------
  it('does not throttle a different email from the same IP (throttle key includes email)', async () => {
    const ip = '203.0.113.99';
    const firstEmail = 'patient@medbridge.test';
    const differentEmail = 'doctor@medbridge.test';

    // Exhaust throttle for firstEmail + ip (10 attempts)
    for (let i = 0; i < 10; i++) {
      await client.fetch('/api/login', {
        method: 'POST',
        extraHeaders: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ email: firstEmail, password: 'WRONG_PASSWORD' }),
      });
    }

    // Confirm that the 11th request for firstEmail is throttled
    const throttledRes = await client.fetch('/api/login', {
      method: 'POST',
      extraHeaders: {
        'Content-Type': 'application/json',
        'x-forwarded-for': ip,
      },
      body: JSON.stringify({ email: firstEmail, password: 'WRONG_PASSWORD' }),
    });
    expect(throttledRes.status).toBe(429);

    // Now use a differentEmail from the same IP — must NOT be throttled
    const notThrottledRes = await client.fetch('/api/login', {
      method: 'POST',
      extraHeaders: {
        'Content-Type': 'application/json',
        'x-forwarded-for': ip,
      },
      body: JSON.stringify({ email: differentEmail, password: 'WRONG_PASSWORD' }),
    });

    // Should reach the verify path (result is 401, not 429)
    expect(notThrottledRes.status, 'different-email request from the same IP must not be 429').toBe(
      401,
    );
  });

  // -------------------------------------------------------------------------
  // Case 7: case-insensitive email throttle
  //   Mixed-case repeats of the same email on the same IP share the counter
  // -------------------------------------------------------------------------
  it('counts mixed-case variants of the same email against the same throttle key (toLowerCase keying)', async () => {
    const verifySpy = vi.spyOn(prodPassword, 'verify');

    const ip = '198.51.100.77';

    // Fire 5 attempts with lowercase
    for (let i = 0; i < 5; i++) {
      await client.fetch('/api/login', {
        method: 'POST',
        extraHeaders: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({
          email: 'patient@medbridge.test',
          password: 'WRONG_PASSWORD',
        }),
      });
    }

    // Fire 5 attempts with mixed-case — same underlying email after toLowerCase
    for (let i = 0; i < 5; i++) {
      await client.fetch('/api/login', {
        method: 'POST',
        extraHeaders: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({
          email: 'PATIENT@MEDBRIDGE.TEST',
          password: 'WRONG_PASSWORD',
        }),
      });
    }

    // verify must have been called 10 times total (5 + 5)
    expect(verifySpy).toHaveBeenCalledTimes(10);

    // 11th request (mixed-case again) — must hit the throttle
    const res = await client.fetch('/api/login', {
      method: 'POST',
      extraHeaders: {
        'Content-Type': 'application/json',
        'x-forwarded-for': ip,
      },
      body: JSON.stringify({
        email: 'Patient@Medbridge.Test',
        password: 'WRONG_PASSWORD',
      }),
    });

    // Must be throttled because the counter reached 10 via combined lower+upper requests
    expect(res.status, 'mixed-case 11th attempt should be throttled (429)').toBe(429);

    // verify still must not have been called for the 11th time
    expect(verifySpy).toHaveBeenCalledTimes(10);
  });
});
