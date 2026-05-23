/**
 * log-redaction.test.ts — pino log-redaction integration tests (B8/B14)
 *
 * Verifies that sensitive values are NEVER emitted to the log stream.
 * One ephemeral Postgres 17 container per file (ARCHITECTURE §8).
 *
 * Cases:
 *   (a) auth.login  — POST /api/login sends body.password; response carries Set-Cookie
 *   (b) auth.refresh — request carries cookies; response carries Set-Cookie
 *   (c) CSRF-failing POST — cookie + mismatched X-CSRF-Token header
 *   (d) Authorization bearer — GET /api/me with Authorization: Bearer <fake-jwt>
 *
 * Redaction target fields (configured in apps/api/src/shared/logger.ts):
 *   req.headers.cookie
 *   req.headers.authorization
 *   req.headers["x-csrf-token"]
 *   req.body.password
 *   res.headers["set-cookie"]
 *
 * Invariants asserted for every captured log line:
 *   - Any redacted field renders as the literal string "[REDACTED]"
 *   - The raw plaintext password from fixtures NEVER appears
 *   - No real JWT substring ("eyJ...") EVER appears
 *   - No raw refresh_token value appears
 *   - No raw csrf_token cookie value appears
 *   - No Set-Cookie header value appears other than "[REDACTED]"
 *   - The raw Bearer value from case (d) NEVER appears
 *
 * NOTE (production bug — do not fix here): The CSRF middleware in
 * apps/api/src/middleware/csrf.ts lists EXEMPT_PATHS "/v1/auth/login" and
 * "/v1/auth/refresh", but app.ts mounts routes at "/api/login" and
 * "/api/refresh". POST /api/login therefore hits the CSRF guard and returns
 * 403 FORBIDDEN instead of 200. Tests in this file work around this by
 * either accepting the 403 log line or injecting session state directly.
 *
 * Requires Docker daemon to be running (testcontainers).
 */
import { createHash, createSecretKey } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Hono } from 'hono';
import { SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { authn } from '../../src/middleware/authn.js';
import type { UserClaims } from '../../src/modules/auth/index.js';
import { createAuthService } from '../../src/modules/auth/index.js';
import { refreshToken as refreshTokenTable } from '../../src/modules/auth/schema.js';
import { createLoginThrottle } from '../../src/modules/auth/throttle.js';
import type { Db } from '../../src/shared/db.js';
import { createPasswordVerifier } from '../../src/shared/password.js';
import { startPostgres } from '../support/container.js';
import { seedFixtures } from '../support/fixtures.js';
import type { LogCaptureHandle, LogRecord } from '../support/logCapture.js';
import { buildCapturingLogger, captureLogs } from '../support/logCapture.js';
import { buildClient } from '../support/request.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Stable 32-char JWT secret for this file. */
const JWT_SECRET = 'log-redaction-test-secret-32chr!';

/** The plaintext password for the seeded patient fixture. */
const PATIENT_PASSWORD = 'patientpass123!';

/** Fake JWT value used in Authorization: Bearer header test (case d). */
const FAKE_JWT = 'eyJ' + 'fakejwt'.repeat(5);

// ---------------------------------------------------------------------------
// Module-level state (one container per file)
// ---------------------------------------------------------------------------

let stopContainer: () => Promise<void>;
let pool: Pool;
let db: Db;
let app: Hono;
let logHandle: LogCaptureHandle;

/** All raw strings written to process.stdout during a test. */
let stdoutChunks: string[];

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

/**
 * Insert a refresh_token row directly into the DB (bypasses the login
 * CSRF bug so tests can obtain a valid refresh token without going through
 * POST /api/login).
 */
async function insertRefreshTokenRow(userId: string, rawToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(refreshTokenTable).values({ userId, tokenHash, expiresAt }).returning();
}

/**
 * Assert that a string value (from a log record field) is either absent or
 * equals the literal censor string "[REDACTED]".
 */
function assertRedactedOrAbsent(value: unknown, fieldLabel: string): void {
  if (value === undefined || value === null) return;
  expect(value, `${fieldLabel} must be "[REDACTED]" when present in logs`).toBe('[REDACTED]');
}

/**
 * Assert that none of the captured log lines contain the given raw substring.
 */
function assertNeverInLogs(rawValue: string, label: string, allChunks: string[]): void {
  for (const chunk of allChunks) {
    expect(chunk, `stdout must never contain raw ${label} value`).not.toContain(rawValue);
  }
}

/**
 * Collect all text chunks from both the in-memory capture handle and the
 * stdout spy into a single flat string array for bulk assertions.
 */
function allCapturedText(chunks: string[], records: LogRecord[]): string[] {
  const fromRecords = records.map((r) => JSON.stringify(r));
  return [...chunks, ...fromRecords];
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Inject JWT_SECRET so the authn middleware can verify session JWTs.
  process.env['JWT_SECRET'] = JWT_SECRET;

  const { url, stop } = await startPostgres();
  stopContainer = stop;

  pool = new Pool({ connectionString: url });
  // biome-ignore lint/suspicious/noExplicitAny: drizzle schema cast mirrors other test files
  db = drizzle(pool, { schema: {} as any }) as unknown as Db;

  // Wire the capturing logger for service-level log assertions (Option A).
  logHandle = captureLogs();
  const capturingLog = buildCapturingLogger(logHandle);

  const service = createAuthService({
    db,
    throttle: createLoginThrottle(),
    verifyPassword: createPasswordVerifier().verify,
    signSessionJwt,
    hashRefreshToken,
    now: () => new Date(),
    log: capturingLog,
  });

  app = createApp({ service, authn });
}, 60_000);

afterAll(async () => {
  await pool.end();
  await stopContainer();
}, 30_000);

beforeEach(async () => {
  // Truncate and re-seed canonical fixture users.
  await seedFixtures(db);

  // Clear service-level captured records.
  logHandle.records.splice(0, logHandle.records.length);

  // Option B: spy on process.stdout.write to capture ALL pino output
  // (middleware HTTP log lines + service-level logs).
  stdoutChunks = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(
    (chunk: unknown, ...args: unknown[]): boolean => {
      try {
        const str = typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8');
        stdoutChunks.push(str);
      } catch {
        // Non-string chunk — ignore for capture but do not crash.
      }
      // Suppress the original write to keep test output clean.
      void args;
      return true;
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test suite — auth.login (case a)
// ---------------------------------------------------------------------------

describe('auth.login — log redaction on POST /api/login', () => {
  it('(a) never emits the raw password or a real JWT in any log line', async () => {
    const client = buildClient(app);

    // POST /api/login with the fixture password in the request body.
    // NOTE: Due to the csrf.ts EXEMPT_PATHS / mount-prefix mismatch (production
    // bug), this returns 403 FORBIDDEN — the CSRF middleware runs first and
    // logs the request before rejecting it. The log line is still captured and
    // must not contain the raw password.
    await client.fetch('/api/login', {
      method: 'POST',
      extraHeaders: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@medbridge.test', password: PATIENT_PASSWORD }),
    });

    // Build the full capture corpus: stdout spy + in-memory handle.
    const corpus = allCapturedText(stdoutChunks, logHandle.records);

    // The raw plaintext password must NEVER appear anywhere in captured output.
    assertNeverInLogs(PATIENT_PASSWORD, 'plaintext password', corpus);

    // No real JWT (no "eyJ..." substring) must appear in any log line.
    assertNeverInLogs('eyJ', 'JWT prefix (eyJ)', corpus);

    // Verify that any req.body.password field in the parsed records is redacted.
    for (const record of logHandle.records) {
      const req = record['req'] as Record<string, unknown> | undefined;
      if (req !== undefined) {
        const body = req['body'] as Record<string, unknown> | undefined;
        if (body !== undefined) {
          assertRedactedOrAbsent(body['password'], 'req.body.password');
        }
      }
    }
  });

  it('(a) never emits raw Set-Cookie values in log lines generated during auth.login', async () => {
    const client = buildClient(app);

    await client.fetch('/api/login', {
      method: 'POST',
      extraHeaders: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@medbridge.test', password: PATIENT_PASSWORD }),
    });

    const corpus = allCapturedText(stdoutChunks, logHandle.records);

    // set-cookie header value must not appear raw in logs.
    for (const record of logHandle.records) {
      const res = record['res'] as Record<string, unknown> | undefined;
      if (res !== undefined) {
        const headers = res['headers'] as Record<string, unknown> | undefined;
        if (headers !== undefined) {
          assertRedactedOrAbsent(headers['set-cookie'], 'res.headers["set-cookie"]');
        }
      }
    }

    // No raw JWT-shaped value starting with "eyJ" in any chunk.
    assertNeverInLogs('eyJ', 'JWT prefix (eyJ)', corpus);
  });
});

// ---------------------------------------------------------------------------
// Test suite — auth.refresh (case b)
// ---------------------------------------------------------------------------

describe('auth.refresh — log redaction on POST /api/refresh', () => {
  it('(b) never emits raw cookie values or real JWTs during token rotation', async () => {
    // Bypass the login CSRF bug by directly seeding the DB state.
    const { patient } = await seedFixtures(db);
    const rawRefreshToken = 'raw-refresh-token-for-log-redaction-b-test';
    await insertRefreshTokenRow(patient.id, rawRefreshToken);

    // Mint a valid session JWT so we can pass CSRF with a crafted cookie header.
    const sessionJwt = await signSessionJwt({
      userId: patient.id,
      email: patient.email,
      role: patient.role,
    });

    const rawCsrfToken = 'csrf-token-for-log-redaction-test-b';

    // POST /api/refresh with all required cookies.
    // The CSRF middleware exemption bug means /api/refresh is NOT exempt
    // (exempt list has "/v1/auth/refresh", not "/api/refresh"). However, if
    // the csrf_token cookie and X-CSRF-Token header match, CSRF passes.
    const req = new Request('http://test.local/api/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session=${sessionJwt}; refresh_token=${rawRefreshToken}; csrf_token=${rawCsrfToken}`,
        'X-CSRF-Token': rawCsrfToken,
      },
      body: JSON.stringify({}),
    });

    await app.fetch(req);

    const corpus = allCapturedText(stdoutChunks, logHandle.records);

    // Raw refresh_token value must never appear in any log line.
    assertNeverInLogs(rawRefreshToken, 'raw refresh_token', corpus);

    // Raw csrf_token value must never appear.
    assertNeverInLogs(rawCsrfToken, 'raw csrf_token', corpus);

    // No real JWT (no "eyJ..." substring) must appear.
    assertNeverInLogs('eyJ', 'JWT prefix (eyJ)', corpus);

    // req.headers.cookie must be "[REDACTED]" when present.
    for (const record of logHandle.records) {
      const reqField = record['req'] as Record<string, unknown> | undefined;
      if (reqField !== undefined) {
        const headers = reqField['headers'] as Record<string, unknown> | undefined;
        if (headers !== undefined) {
          assertRedactedOrAbsent(headers['cookie'], 'req.headers.cookie');
        }
      }
    }

    // res.headers["set-cookie"] must be "[REDACTED]" when present.
    for (const record of logHandle.records) {
      const resField = record['res'] as Record<string, unknown> | undefined;
      if (resField !== undefined) {
        const headers = resField['headers'] as Record<string, unknown> | undefined;
        if (headers !== undefined) {
          assertRedactedOrAbsent(headers['set-cookie'], 'res.headers["set-cookie"]');
        }
      }
    }
  });

  it('(b) res.headers["set-cookie"] field is never the raw value in captured records', async () => {
    const { patient } = await seedFixtures(db);
    const rawRefreshToken = 'raw-refresh-token-for-log-redaction-b2-test';
    await insertRefreshTokenRow(patient.id, rawRefreshToken);

    const sessionJwt = await signSessionJwt({
      userId: patient.id,
      email: patient.email,
      role: patient.role,
    });
    const rawCsrfToken = 'csrf-set-cookie-check-test';

    await app.fetch(
      new Request('http://test.local/api/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `session=${sessionJwt}; refresh_token=${rawRefreshToken}; csrf_token=${rawCsrfToken}`,
          'X-CSRF-Token': rawCsrfToken,
        },
        body: JSON.stringify({}),
      }),
    );

    // Ensure stdout also has no raw cookie values.
    assertNeverInLogs(rawRefreshToken, 'raw refresh_token in stdout', stdoutChunks);
    assertNeverInLogs(rawCsrfToken, 'raw csrf_token in stdout', stdoutChunks);
  });
});

// ---------------------------------------------------------------------------
// Test suite — CSRF-failing POST (case c)
// ---------------------------------------------------------------------------

describe('CSRF-failing POST — log redaction when CSRF mismatch occurs', () => {
  it('(c) never emits raw cookie or x-csrf-token header values in log lines for a 403 CSRF rejection', async () => {
    const { patient } = await seedFixtures(db);
    const rawRefreshToken = 'raw-refresh-token-for-log-redaction-c-test';
    await insertRefreshTokenRow(patient.id, rawRefreshToken);

    const sessionJwt = await signSessionJwt({
      userId: patient.id,
      email: patient.email,
      role: patient.role,
    });

    const rawCsrfCookie = 'csrf-cookie-value-c-test';
    // Intentionally mismatched header to trigger CSRF failure.
    const mismatchedCsrfHeader = 'THIS-DOES-NOT-MATCH-THE-COOKIE';

    const req = new Request('http://test.local/api/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session=${sessionJwt}; refresh_token=${rawRefreshToken}; csrf_token=${rawCsrfCookie}`,
        'X-CSRF-Token': mismatchedCsrfHeader,
      },
      body: JSON.stringify({}),
    });

    const res = await app.fetch(req);

    // The CSRF middleware should reject with 403.
    expect(res.status).toBe(403);

    const corpus = allCapturedText(stdoutChunks, logHandle.records);

    // Raw cookie value must never appear.
    assertNeverInLogs(rawCsrfCookie, 'raw csrf_token cookie', corpus);

    // Raw X-CSRF-Token header value must never appear.
    assertNeverInLogs(mismatchedCsrfHeader, 'raw X-CSRF-Token header value', corpus);

    // Raw session JWT must never appear.
    assertNeverInLogs('eyJ', 'JWT prefix (eyJ)', corpus);

    // Raw refresh_token must never appear.
    assertNeverInLogs(rawRefreshToken, 'raw refresh_token', corpus);

    // Verify redaction in captured pino records.
    for (const record of logHandle.records) {
      const reqField = record['req'] as Record<string, unknown> | undefined;
      if (reqField !== undefined) {
        const headers = reqField['headers'] as Record<string, unknown> | undefined;
        if (headers !== undefined) {
          assertRedactedOrAbsent(headers['cookie'], 'req.headers.cookie');
          assertRedactedOrAbsent(headers['x-csrf-token'], 'req.headers["x-csrf-token"]');
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Test suite — Authorization: Bearer header (case d)
// ---------------------------------------------------------------------------

describe('Authorization Bearer header — log redaction for Authorization header', () => {
  it('(d) the raw Bearer value never appears in any log line and authorization field shows [REDACTED]', async () => {
    // Use the buildCapturingLogger to log a request-shaped object that
    // includes req.headers.authorization, verifying the pino redaction path.
    const captureHandle = captureLogs();
    const testLogger = buildCapturingLogger(captureHandle);

    // Simulate logging a request event that includes headers (as a structured
    // pino log entry), mirroring what a pino-http or custom HTTP serializer
    // would emit when the Authorization header is present.
    testLogger.info(
      {
        req: {
          method: 'GET',
          url: '/api/me',
          headers: {
            authorization: `Bearer ${FAKE_JWT}`,
            cookie: 'session=eyJsometoken; csrf_token=csrf-value-d',
          },
        },
      },
      'request.complete',
    );

    // The raw bearer value must NOT appear in any captured record.
    const allText = captureHandle.records.map((r) => JSON.stringify(r));
    assertNeverInLogs(FAKE_JWT, 'raw Bearer JWT value', allText);

    // The authorization field must render as "[REDACTED]".
    const record = captureHandle.records[0];
    expect(record, 'at least one record must be captured').toBeDefined();
    const reqField = record?.['req'] as Record<string, unknown> | undefined;
    expect(reqField, 'req field must be present in log record').toBeDefined();
    const headers = reqField?.['headers'] as Record<string, unknown> | undefined;
    expect(headers, 'req.headers must be present in log record').toBeDefined();
    expect(headers?.['authorization'], 'req.headers.authorization must be "[REDACTED]"').toBe(
      '[REDACTED]',
    );

    // The cookie field must also be "[REDACTED]".
    assertRedactedOrAbsent(headers?.['cookie'], 'req.headers.cookie in captured record');

    // "eyJ" must never appear anywhere in the captured output.
    assertNeverInLogs('eyJ', 'JWT prefix (eyJ) in captured records', allText);
  });

  it('(d) stdout spy never captures the raw Bearer value when a request with Authorization header is handled', async () => {
    // Make a GET /api/me request with a fake Authorization header.
    // The authn middleware reads the session cookie, not Authorization,
    // but the middleware logger may still have access to headers. The test
    // asserts the raw Bearer value never appears in any stdout output.
    const req = new Request('http://test.local/api/me', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${FAKE_JWT}`,
        Cookie: 'session=no-valid-session',
      },
    });

    await app.fetch(req);

    // Raw FAKE_JWT must never appear in any captured stdout chunk.
    assertNeverInLogs(FAKE_JWT, 'raw Bearer JWT value in stdout', stdoutChunks);

    // No "eyJ" prefix in any captured stdout output.
    assertNeverInLogs('eyJ', 'JWT prefix (eyJ) in stdout', stdoutChunks);
  });

  it('(d) buildCapturingLogger redacts authorization path — [REDACTED] assertion with eyJ prefix', async () => {
    // Construct a fake JWT-shaped bearer value starting with "eyJ".
    const bearerValue = `Bearer ${'eyJ' + 'fakepayload'.repeat(4)}`;

    const captureHandle = captureLogs();
    const testLogger = buildCapturingLogger(captureHandle);

    testLogger.info(
      {
        req: {
          method: 'GET',
          url: '/api/me',
          headers: {
            authorization: bearerValue,
          },
          body: {
            password: PATIENT_PASSWORD,
          },
        },
        res: {
          statusCode: 200,
          headers: {
            'set-cookie': 'session=eyJrealtoken; Path=/; HttpOnly',
          },
        },
      },
      'http.request',
    );

    const record = captureHandle.records[0];
    expect(record).toBeDefined();

    const reqField = record?.['req'] as Record<string, unknown> | undefined;
    const resField = record?.['res'] as Record<string, unknown> | undefined;

    const reqHeaders = reqField?.['headers'] as Record<string, unknown> | undefined;
    const reqBody = reqField?.['body'] as Record<string, unknown> | undefined;
    const resHeaders = resField?.['headers'] as Record<string, unknown> | undefined;

    // req.headers.authorization must be "[REDACTED]".
    expect(reqHeaders?.['authorization']).toBe('[REDACTED]');

    // req.body.password must be "[REDACTED]".
    expect(reqBody?.['password']).toBe('[REDACTED]');

    // res.headers["set-cookie"] must be "[REDACTED]".
    expect(resHeaders?.['set-cookie']).toBe('[REDACTED]');

    // Serialised record must not contain the raw bearer value or "eyJ" prefix.
    const serialised = JSON.stringify(record);
    expect(serialised).not.toContain(PATIENT_PASSWORD);
    expect(serialised).not.toContain('eyJ');
    expect(serialised).not.toContain(bearerValue);
  });
});
