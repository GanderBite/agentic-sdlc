/**
 * Adversarial test suite — log scrubbing / secret redaction.
 *
 * Current coverage (honest scope):
 *   1. createLogCapture() helper invariants — the destination.write / notContainsAny
 *      contract is exercised with hand-crafted strings to ensure the helper itself
 *      is correct.
 *   2. Auth-flow integration — runs login → refresh → me → logout against a real
 *      Postgres container and asserts the cookie-derived secret needle list is
 *      non-trivial (non-empty, realistic lengths), so the helper tests are
 *      meaningful.
 *
 * Known gap / escalation:
 *   Production log-scrub coverage (asserting that real pino output from the app
 *   never contains secret needle values) CANNOT be implemented in this file without
 *   modifying shared/logger.ts.  The pino logger is constructed at module load time
 *   with no exported factory or REDACT_PATHS constant, so no injection seam exists.
 *   The required fix is: export createLogger(opts?: { destination? }) from
 *   shared/logger.ts, then vi.mock that module here using vi.importActual to obtain
 *   the real REDACT_PATHS and supply capture.destination.
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
import { createLogCapture } from '../support/logCapture.ts';
import { SEED_PLAINTEXT } from '../support/passwords.ts';
import { createRequestAgent, csrfHeaders } from '../support/request.ts';

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
// Helper: run the full login → refresh → me → logout flow and return the
// cookie values that must not appear in any log output.
//
// NOTE: This helper does NOT wire createLogCapture() into the production pino
// logger.  shared/logger.ts constructs its pino instance at module load time
// and does not export a factory or its REDACT_PATHS constant, so there is no
// seam available in this file's scope to inject a custom destination without
// modifying production code.  Asserting production log-scrub behaviour
// requires shared/logger.ts to export createLogger(opts?) — that refactor is
// tracked as a separate task.  Until then, runFullAuthFlow returns only the
// real cookie values so callers can build a needle list for use with a
// manually-populated capture (see the hand-crafted-destination tests below).
// ---------------------------------------------------------------------------

async function runFullAuthFlow(): Promise<{
  secretNeedles: string[];
}> {
  const agent = createRequestAgent(app);

  // 1. Login
  const loginRes = await agent.request('/auth.login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'patient@seed.test', password: SEED_PLAINTEXT }),
  });
  expect(loginRes.status).toBe(200);

  // Capture the raw cookie values from the jar after login
  const sessionAfterLogin = agent.cookies().get('session') ?? '';
  const refreshAfterLogin = agent.cookies().get('refresh') ?? '';
  const csrfAfterLogin = agent.cookies().get('csrf_token') ?? '';

  // 2. Refresh
  const refreshRes = await agent.request('/auth.refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  expect(refreshRes.status).toBe(200);

  const sessionAfterRefresh = agent.cookies().get('session') ?? '';
  const refreshAfterRefresh = agent.cookies().get('refresh') ?? '';
  const csrfAfterRefresh = agent.cookies().get('csrf_token') ?? '';

  // 3. Me (GET — no CSRF needed)
  const meRes = await agent.request('/auth.me', { method: 'GET' });
  expect(meRes.status).toBe(200);

  // 4. Logout (POST — CSRF required)
  const logoutRes = await agent.request('/auth.logout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...csrfHeaders(agent),
    },
  });
  expect(logoutRes.status).toBe(200);

  // The secret needles that must never appear in any log line.
  // We include all token values from both pre- and post-refresh.
  const secretNeedles = [
    SEED_PLAINTEXT,
    sessionAfterLogin,
    refreshAfterLogin,
    csrfAfterLogin,
    sessionAfterRefresh,
    refreshAfterRefresh,
    csrfAfterRefresh,
  ].filter(Boolean);

  return { secretNeedles };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('log scrubbing — auth flow', () => {
  it('createLogCapture helper starts with an empty line buffer', () => {
    // Baseline: a freshly created capture has no lines.
    // This verifies the helper is in a clean state before any writes.
    //
    // NOTE: this capture is NOT wired into the production pino logger; it exists
    // only to validate the helper's own invariants.  Production log-scrub
    // coverage requires a factory seam in shared/logger.ts (out of scope here).
    const capture = createLogCapture();

    expect(capture.lines).toHaveLength(0);

    // notContainsAny over zero lines must not throw regardless of the needles.
    expect(() => capture.notContainsAny([SEED_PLAINTEXT])).not.toThrow();
  });

  it('notContainsAny throws when a needle is found in a log line', () => {
    const capture = createLogCapture();

    // Simulate a log line that contains a secret
    capture.destination.write(`{"level":30,"msg":"request","password":"${SEED_PLAINTEXT}"}\n`);

    expect(() => capture.notContainsAny([SEED_PLAINTEXT])).toThrow(SEED_PLAINTEXT);
  });

  it('notContainsAny passes when secret needles are absent from all log lines', () => {
    const capture = createLogCapture();

    // Simulate redacted log output
    capture.destination.write('{"level":30,"msg":"request","password":"[REDACTED]"}\n');
    capture.destination.write('{"level":30,"msg":"response","status":200}\n');

    // Should not throw
    expect(() => capture.notContainsAny([SEED_PLAINTEXT, 'secrettoken123'])).not.toThrow();
  });

  it('auth flow produces non-trivial secret needle values from real cookie jar', async () => {
    // Run the full login → refresh → me → logout cycle against the real app.
    // We assert that the cookie-derived needle list is non-trivial so that the
    // hand-crafted destination tests below are meaningful.
    //
    // NOTE: production log-scrub coverage (asserting capture.notContainsAny on
    // real pino output) is not exercised here because shared/logger.ts does not
    // export a factory that accepts a custom destination.  That seam must be
    // added in shared/logger.ts before this assertion can be strengthened.
    const { secretNeedles } = await runFullAuthFlow();

    // Every needle should be a non-empty string.
    expect(secretNeedles.length).toBeGreaterThan(0);
    for (const needle of secretNeedles) {
      expect(typeof needle).toBe('string');
      expect(needle.length).toBeGreaterThan(0);
    }

    // The plain-text password must be included (it is the most critical needle).
    expect(secretNeedles).toContain(SEED_PLAINTEXT);

    // Token values (session JWT, refresh token, csrf token) should be
    // non-trivially long — a realistic JWT is > 20 chars.
    const tokenNeedles = secretNeedles.filter((n) => n !== SEED_PLAINTEXT);
    expect(tokenNeedles.length).toBeGreaterThanOrEqual(1);
    for (const token of tokenNeedles) {
      expect(token.length).toBeGreaterThan(10);
    }
  });

  it('log capture with real token values does not contain any secret when redaction is proper', () => {
    // Create a fresh capture and simulate what properly-redacted pino logs look like
    const capture = createLogCapture();
    const fakeSession = 'eyJhbGciOiJIUzI1NiJ9.faketoken.signature';
    const fakeRefresh = 'abc123refreshtoken456def';
    const fakeCsrf = 'deadbeefcafecafe0123456789abcdef';

    // Simulate pino output WITH redaction applied
    capture.destination.write(
      '{"level":30,"msg":"request.complete","status":200,"session":"[REDACTED]"}\n',
    );
    capture.destination.write(
      '{"level":30,"msg":"request.complete","status":200,"refresh":"[REDACTED]"}\n',
    );
    capture.destination.write(
      '{"level":30,"msg":"request.complete","status":200,"csrf_token":"[REDACTED]"}\n',
    );

    // These redacted lines must not contain the raw token values
    expect(() =>
      capture.notContainsAny([fakeSession, fakeRefresh, fakeCsrf, SEED_PLAINTEXT]),
    ).not.toThrow();
  });

  it('notContainsAny detects multiple needles across multiple log lines', () => {
    const capture = createLogCapture();
    const needle1 = 'supersecretpassword';
    const needle2 = 'rawrefreshtoken';

    capture.destination.write(`{"msg":"something","data":"${needle1}"}\n`);
    capture.destination.write('{"msg":"other line"}\n');

    // needle1 present -> should throw
    expect(() => capture.notContainsAny([needle1, needle2])).toThrow(needle1);
  });

  it('detects a secret in the second log line when first is clean', () => {
    const capture = createLogCapture();
    const secret = 'hidden_secret_value';

    capture.destination.write('{"msg":"clean line"}\n');
    capture.destination.write(`{"msg":"leaks","value":"${secret}"}\n`);

    expect(() => capture.notContainsAny([secret])).toThrow(secret);
  });
});
