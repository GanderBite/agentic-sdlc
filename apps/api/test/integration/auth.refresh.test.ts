/**
 * auth.refresh integration test suite
 *
 * Covers POST /api/refresh (auth.refresh) — token rotation, replay detection,
 * multi-session isolation, and concurrent-refresh race.
 *
 * Requires a running Docker daemon (Testcontainers).
 * One ephemeral Postgres 17 container is started per file.
 */
import { createHash, createSecretKey } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Hono } from 'hono';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import * as schema from '../../src/db/schema.js';
import { authn } from '../../src/middleware/authn.js';
import type { UserClaims } from '../../src/modules/auth/index.js';
import { createAuthService } from '../../src/modules/auth/index.js';
import { refreshToken as refreshTokenTable } from '../../src/modules/auth/schema.js';
import { createLoginThrottle } from '../../src/modules/auth/throttle.js';
import type { Db } from '../../src/shared/db.js';
import { createPasswordVerifier } from '../../src/shared/password.js';
import { expectAppError } from '../support/assertions.js';
import { startPostgres } from '../support/container.js';
import { seedFixtures } from '../support/fixtures.js';
import type { LogCaptureHandle } from '../support/logCapture.js';
import { buildCapturingLogger, captureLogs } from '../support/logCapture.js';
import { buildClient } from '../support/request.js';

// ---------------------------------------------------------------------------
// Module-level state (one container per file)
// ---------------------------------------------------------------------------

/** JWT_SECRET used throughout this file — injected into process.env before any test. */
const JWT_SECRET = 'x'.repeat(32);

let stopContainer: () => Promise<void>;
let pool: Pool;
let db: Db;
let app: Hono;
let logCapture: LogCaptureHandle;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute the sha256 hex digest of a raw refresh token (mirrors main.ts). */
function hashRefreshToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/** Sign a short-lived HS256 session JWT from the provided claims. */
async function signSessionJwt(claims: UserClaims): Promise<string> {
  const secretKey = createSecretKey(Buffer.from(JWT_SECRET, 'utf8'));
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

/** Query the refresh_token row by raw token value. */
async function findTokenRow(
  rawToken: string,
): Promise<typeof refreshTokenTable.$inferSelect | undefined> {
  const hash = hashRefreshToken(rawToken);
  const rows = await db
    .select()
    .from(refreshTokenTable)
    .where(eq(refreshTokenTable.tokenHash, hash))
    .limit(1);
  return rows[0];
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Inject JWT_SECRET so the authn middleware can verify session JWTs.
  process.env['JWT_SECRET'] = JWT_SECRET;

  // Start the ephemeral Postgres 17 container and apply migrations.
  const { url, stop } = await startPostgres();
  stopContainer = stop;

  // Dedicated pool + drizzle for direct SQL assertions in tests.
  pool = new Pool({ connectionString: url });
  db = drizzle(pool, { schema }) as unknown as Db;

  // Wire the capturing logger so warn entries land in logCapture.records.
  logCapture = captureLogs();
  const log = buildCapturingLogger(logCapture);

  const service = createAuthService({
    db,
    throttle: createLoginThrottle(),
    verifyPassword: createPasswordVerifier().verify,
    signSessionJwt,
    hashRefreshToken,
    now: () => new Date(),
    log,
  });

  app = createApp({ service, authn });
}, 60_000);

afterAll(async () => {
  await pool.end();
  await stopContainer();
}, 30_000);

beforeEach(async () => {
  // Truncate and re-seed fixture users before every test.
  await seedFixtures(db);
  // Clear captured log records so each test starts with an empty slate.
  logCapture.records.splice(0, logCapture.records.length);
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('auth.refresh', () => {
  // -------------------------------------------------------------------------
  // Case 1 — happy-path rotation
  // -------------------------------------------------------------------------

  it('rotates all three cookies on a valid refresh', async () => {
    const client = buildClient(app);
    const loginRes = await client.loginAs('patient@medbridge.test', 'patientpass123!');
    expect(loginRes.status, 'login should succeed').toBe(200);

    const oldRefreshToken = client.getCookie('refresh_token');
    const oldCsrfToken = client.getCookie('csrf_token');
    const oldSession = client.getCookie('session');

    expect(oldRefreshToken, 'refresh_token cookie must be set after login').toBeDefined();
    expect(oldCsrfToken, 'csrf_token cookie must be set after login').toBeDefined();
    expect(oldSession, 'session cookie must be set after login').toBeDefined();

    // POST /api/refresh with CSRF double-submit (the jar holds csrf_token so
    // csrfPost attaches X-CSRF-Token automatically).
    const refreshRes = await client.csrfPost('/api/refresh', {});
    expect(refreshRes.status, 'refresh should return 200').toBe(200);

    const newRefreshToken = client.getCookie('refresh_token');
    const newCsrfToken = client.getCookie('csrf_token');
    const newSession = client.getCookie('session');

    // All three cookies must be present after rotation.
    expect(newRefreshToken, 'new refresh_token must be set').toBeDefined();
    expect(newCsrfToken, 'new csrf_token must be set').toBeDefined();
    expect(newSession, 'new session must be set').toBeDefined();

    // All three must have rotated to new values.
    expect(newRefreshToken, 'refresh_token must rotate').not.toBe(oldRefreshToken);
    expect(newCsrfToken, 'csrf_token must rotate').not.toBe(oldCsrfToken);
    expect(newSession, 'session must rotate').not.toBe(oldSession);

    // The old refresh_token row must be marked revoked (DB column: revoked_at IS NOT NULL).
    if (oldRefreshToken === undefined) {
      throw new Error('oldRefreshToken is undefined — cannot inspect DB row');
    }
    const oldRow = await findTokenRow(oldRefreshToken);
    expect(oldRow, 'old token row must exist in DB').toBeDefined();
    expect(oldRow?.revokedAt, 'old token row must be revoked').not.toBeNull();

    // A fresh non-revoked row must exist for the new refresh token.
    if (newRefreshToken === undefined) {
      throw new Error('newRefreshToken is undefined — cannot inspect DB row');
    }
    const newRow = await findTokenRow(newRefreshToken);
    expect(newRow, 'new token row must exist in DB').toBeDefined();
    expect(newRow?.revokedAt, 'new token row must not be revoked').toBeNull();
  });

  // -------------------------------------------------------------------------
  // Case 2 — scoped-replay coverage: re-send the already-rotated refresh cookie
  // -------------------------------------------------------------------------

  it('returns 401 on replay and logs exactly one warn with userId and requestId', async () => {
    const client = buildClient(app);
    await client.loginAs('patient@medbridge.test', 'patientpass123!');

    const originalRefreshToken = client.getCookie('refresh_token');
    expect(originalRefreshToken).toBeDefined();

    // First refresh — consumes the original token (rotation).
    const firstRefreshRes = await client.csrfPost('/api/refresh', {});
    expect(firstRefreshRes.status, 'first refresh should succeed').toBe(200);

    // Obtain a valid CSRF pair to satisfy the CSRF middleware when replaying.
    // We log in as the doctor on a throw-away client; any matching csrf pair works
    // since the CSRF double-submit check is purely stateless (cookie == header).
    const tempClient = buildClient(app);
    await tempClient.loginAs('doctor@medbridge.test', 'doctorpass123!');
    const tempCsrf = tempClient.getCookie('csrf_token');
    expect(tempCsrf).toBeDefined();

    // Replay the already-rotated original token.
    // A fresh replayClient (empty jar) is used so its jar does not interfere.
    const replayClient = buildClient(app);
    const replayRes = await replayClient.fetch('/api/refresh', {
      method: 'POST',
      extraHeaders: {
        'Content-Type': 'application/json',
        Cookie: `refresh_token=${originalRefreshToken as string}; csrf_token=${tempCsrf as string}`,
        'X-CSRF-Token': tempCsrf as string,
      },
    });

    expect(replayRes.status, 'replay must be rejected with 401').toBe(401);
    await expectAppError(replayRes, 'UNAUTHORIZED');

    // The old row must still have revokedAt IS NOT NULL after the replay attempt.
    if (originalRefreshToken === undefined) {
      throw new Error('originalRefreshToken is undefined');
    }
    const oldRow = await findTokenRow(originalRefreshToken);
    expect(oldRow, 'old token row must exist').toBeDefined();
    expect(oldRow?.revokedAt, 'old token row must remain revoked after replay').not.toBeNull();

    // Pino warn level is numeric 40.
    // The service emits: log.warn({ userId, requestId }, "refresh_token replay detected")
    // only for the already-revoked path (the row exists but revokedAt !== null).
    const warnRecords = logCapture.records.filter(
      (r) => r['level'] === 40 && r['userId'] !== undefined && r['requestId'] !== undefined,
    );
    expect(
      warnRecords.length,
      'exactly one warn log with userId and requestId expected for replay',
    ).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Case 3 — MULTI-SESSION ISOLATION: sessionA replay must not sweep sessionB
  // -------------------------------------------------------------------------

  it('does not revoke sessionB tokens when sessionA replays (two independent sessions)', async () => {
    // sessionA: first independent login.
    const clientA = buildClient(app);
    await clientA.loginAs('patient@medbridge.test', 'patientpass123!');
    const sessionARefresh = clientA.getCookie('refresh_token');
    expect(sessionARefresh).toBeDefined();

    // sessionB: second independent login for the SAME user — two active sessions.
    const clientB = buildClient(app);
    await clientB.loginAs('patient@medbridge.test', 'patientpass123!');
    const sessionBRefresh = clientB.getCookie('refresh_token');
    expect(sessionBRefresh).toBeDefined();

    // Both sessions must hold distinct tokens.
    expect(sessionARefresh, 'sessionA and sessionB must receive distinct tokens').not.toBe(
      sessionBRefresh,
    );

    // Rotate sessionA's token (first use — valid).
    const rotateARes = await clientA.csrfPost('/api/refresh', {});
    expect(rotateARes.status, 'first rotate of sessionA should succeed').toBe(200);
    const sessionARefreshRotated = clientA.getCookie('refresh_token');
    expect(sessionARefreshRotated, 'sessionA token must rotate').not.toBe(sessionARefresh);

    // Replay the ORIGINAL sessionA token (already rotated → revoked).
    // Reuse sessionA's current csrf_token from the post-rotation jar.
    const sessionACsrf = clientA.getCookie('csrf_token');
    expect(sessionACsrf).toBeDefined();

    const replayARes = await clientA.fetch('/api/refresh', {
      method: 'POST',
      extraHeaders: {
        'Content-Type': 'application/json',
        Cookie: `refresh_token=${sessionARefresh as string}; csrf_token=${sessionACsrf as string}`,
        'X-CSRF-Token': sessionACsrf as string,
      },
    });
    expect(replayARes.status, 'replay of old sessionA token must be 401').toBe(401);
    await expectAppError(replayARes, 'UNAUTHORIZED');

    // sessionB's token was never rotated and must still be valid.
    // A successful refresh here proves the family of other active tokens was NOT swept.
    const sessionBRefreshRes = await clientB.csrfPost('/api/refresh', {});
    expect(
      sessionBRefreshRes.status,
      'sessionB must still be valid after sessionA replay — no family sweep',
    ).toBe(200);

    const sessionBNewRefresh = clientB.getCookie('refresh_token');
    expect(sessionBNewRefresh, 'sessionB new refresh token must be set').toBeDefined();
    expect(sessionBNewRefresh, 'sessionB token must rotate').not.toBe(sessionBRefresh);

    // Confirm the original sessionB row is revoked (consumed by the refresh above).
    if (sessionBRefresh === undefined || sessionBNewRefresh === undefined) {
      throw new Error('sessionB token variables are undefined');
    }
    const oldBRow = await findTokenRow(sessionBRefresh);
    expect(
      oldBRow?.revokedAt,
      'original sessionB row must be revoked after rotation',
    ).not.toBeNull();

    const newBRow = await findTokenRow(sessionBNewRefresh);
    expect(newBRow?.revokedAt, 'new sessionB row must not be revoked').toBeNull();
  });

  // -------------------------------------------------------------------------
  // Case 4 — concurrent-refresh race: exactly one winner
  // -------------------------------------------------------------------------

  it('allows exactly one winner in a concurrent-refresh race', async () => {
    // Log in once to obtain a single refresh token.
    const seedClient = buildClient(app);
    await seedClient.loginAs('patient@medbridge.test', 'patientpass123!');

    const sharedRefreshToken = seedClient.getCookie('refresh_token');
    const sharedCsrfToken = seedClient.getCookie('csrf_token');
    expect(sharedRefreshToken).toBeDefined();
    expect(sharedCsrfToken).toBeDefined();

    // Build two independent clients that both hold the SAME refresh + csrf cookie.
    // Their jars are empty; the cookies are supplied via extraHeaders on each request.
    const clientX = buildClient(app);
    const clientY = buildClient(app);

    // Fire both refreshes concurrently via Promise.all.
    const [resX, resY] = await Promise.all([
      clientX.fetch('/api/refresh', {
        method: 'POST',
        extraHeaders: {
          'Content-Type': 'application/json',
          Cookie: `refresh_token=${sharedRefreshToken as string}; csrf_token=${sharedCsrfToken as string}`,
          'X-CSRF-Token': sharedCsrfToken as string,
        },
      }),
      clientY.fetch('/api/refresh', {
        method: 'POST',
        extraHeaders: {
          'Content-Type': 'application/json',
          Cookie: `refresh_token=${sharedRefreshToken as string}; csrf_token=${sharedCsrfToken as string}`,
          'X-CSRF-Token': sharedCsrfToken as string,
        },
      }),
    ]);

    const statuses = [resX.status, resY.status];

    // Exactly one request must succeed (200) and the other must be rejected (401).
    expect(
      statuses.filter((s) => s === 200).length,
      'exactly one concurrent refresh must succeed with 200',
    ).toBe(1);
    expect(
      statuses.filter((s) => s === 401).length,
      'exactly one concurrent refresh must be rejected with 401',
    ).toBe(1);
  });
});
