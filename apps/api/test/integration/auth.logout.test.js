/**
 * Integration tests: auth.logout
 *
 * REQUIRES: Docker daemon running on the host (testcontainers).
 *
 * Covers:
 *  - Happy path: 200; session and refresh cookies are cleared (Max-Age=0);
 *    the active refresh_token row is revoked in the database.
 *  - Missing auth: 403 (CSRF) or 401 (authn) when no session/csrf cookies.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startPostgresContainer } from '../support/db.ts';
import { insertSeedUsers, truncate } from '../support/fixtures.ts';
import { SEED_PLAIN_PASSWORD } from '../support/passwords.ts';
import { createRequestAgent } from '../support/request.ts';
// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------
let testDb;
let agent;
// ---------------------------------------------------------------------------
// Lifecycle: one container per file
// ---------------------------------------------------------------------------
beforeAll(async () => {
    testDb = await startPostgresContainer();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes-long!!';
    process.env.NODE_ENV = 'test';
    const { Hono: HonoClass } = await import('hono');
    const { cors } = await import('hono/cors');
    const { errorHandler } = await import('../../src/middleware/errorHandler.js');
    const { requestId } = await import('../../src/middleware/requestId.js');
    const { logger: loggerMw } = await import('../../src/middleware/logger.js');
    const { createAuthService, wireAuth } = await import('../../src/modules/auth/index.js');
    const { defaultPasswordHasher } = await import('../../src/modules/auth/passwords.js');
    const authRepo = await import('../../src/modules/auth/repo.js');
    const { defaultClock } = await import('../../src/shared/time.js');
    const { logger } = await import('../../src/shared/logger.js');
    const app = new HonoClass();
    app.use('*', requestId);
    app.use('*', loggerMw);
    app.use('*', cors({ origin: '*', credentials: false }));
    // Routes declare per-route middleware; no global csrf/authn needed.
    // auth.logout in routes.ts uses explicit `csrf, authn` middleware.
    const apiRouter = new HonoClass();
    const authService = createAuthService({
        repo: {
            findUserByEmail: authRepo.findUserByEmail,
            findUserById: authRepo.findUserById,
            insertRefreshToken: authRepo.insertRefreshToken,
            rotateRefreshToken: authRepo.rotateRefreshToken,
            findRefreshTokenAnywhere: authRepo.findRefreshTokenAnywhere,
            revokeAllActiveForUser: authRepo.revokeAllActiveForUser,
        },
        hasher: defaultPasswordHasher,
        clock: defaultClock,
        logger: logger.child({ module: 'auth' }),
    });
    wireAuth(apiRouter, { service: authService });
    app.route('/api', apiRouter);
    app.onError(errorHandler);
    agent = createRequestAgent(app);
}, 60_000);
afterAll(async () => {
    const { closeDb } = await import('../../src/db/client.js');
    await closeDb();
    await testDb.pool.end();
    await testDb.container.stop();
}, 30_000);
beforeEach(async () => {
    await truncate(testDb.pool);
    agent.reset();
});
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function extractCookieValue(res, name) {
    const headers = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie') ?? '').split(',').filter(Boolean);
    const header = headers.find((h) => h.trimStart().startsWith(`${name}=`));
    if (!header)
        return undefined;
    const firstSemi = header.indexOf(';');
    const pair = firstSemi === -1 ? header : header.slice(0, firstSemi);
    const eqIdx = pair.indexOf('=');
    return eqIdx === -1 ? undefined : pair.slice(eqIdx + 1).trim();
}
function getSetCookies(res) {
    if (typeof res.headers.getSetCookie === 'function') {
        return res.headers.getSetCookie();
    }
    const raw = res.headers.get('set-cookie') ?? '';
    return raw.length > 0 ? raw.split(',').filter(Boolean) : [];
}
/** Returns true when the Set-Cookie directive contains Max-Age=0 (cookie cleared). */
function isCookieCleared(header) {
    return header.split(';').some((p) => p.trim().toLowerCase() === 'max-age=0');
}
async function loginAsPatient() {
    const res = await agent.fetch('/api/auth.login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'patient@test.local', password: SEED_PLAIN_PASSWORD }),
    });
    if (res.status !== 200) {
        throw new Error(`Login failed: ${res.status}`);
    }
}
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('auth.logout — happy path', () => {
    it('when authenticated, returns 200 and clears session + refresh cookies', async () => {
        // arrange
        await insertSeedUsers(testDb.db);
        await loginAsPatient();
        // act — agent auto-injects X-CSRF-Token from the csrf_token cookie
        const res = await agent.fetch('/api/auth.logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        // assert — status
        expect(res.status).toBe(200);
        // assert — session and refresh cookies are cleared (Max-Age=0)
        const cookies = getSetCookies(res);
        const sessionHeader = cookies.find((h) => h.trimStart().startsWith('session='));
        const refreshHeader = cookies.find((h) => h.trimStart().startsWith('refresh='));
        expect(sessionHeader).toBeDefined();
        expect(refreshHeader).toBeDefined();
        expect(isCookieCleared(sessionHeader ?? '')).toBe(true);
        expect(isCookieCleared(refreshHeader ?? '')).toBe(true);
    });
    it('when authenticated, the active refresh_token row is revoked in the database', async () => {
        // arrange — log in and capture the refresh token value before logout
        await insertSeedUsers(testDb.db);
        const loginRes = await agent.fetch('/api/auth.login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'patient@test.local', password: SEED_PLAIN_PASSWORD }),
        });
        expect(loginRes.status).toBe(200);
        const refreshValue = extractCookieValue(loginRes, 'refresh');
        expect(refreshValue).toBeDefined();
        const { refreshToken } = await import('../../src/db/schema.js');
        const { hashRefreshToken } = await import('../../src/modules/auth/tokens.js');
        const hash = await hashRefreshToken(refreshValue ?? '');
        // Confirm the row is active before logout
        const beforeRows = await testDb.db
            .select()
            .from(refreshToken)
            .where(eq(refreshToken.hash, hash));
        expect(beforeRows[0]?.revokedAt).toBeNull();
        // act — logout (agent has session + csrf_token cookies from login)
        const logoutRes = await agent.fetch('/api/auth.logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(logoutRes.status).toBe(200);
        // assert — row now has revoked_at set
        const afterRows = await testDb.db
            .select()
            .from(refreshToken)
            .where(eq(refreshToken.hash, hash));
        expect(afterRows[0]?.revokedAt).not.toBeNull();
    });
});
describe('auth.logout — unauthenticated', () => {
    it('when no session cookie is present, returns a non-2xx error response', async () => {
        // arrange — do NOT log in
        await insertSeedUsers(testDb.db);
        // act — POST logout without session or csrf_token cookies
        // auth.logout route has per-route `csrf, authn` middleware (routes.ts)
        const res = await agent.fetch('/api/auth.logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            skipCsrf: true, // no csrf_token cookie in jar, so no header to inject
        });
        // assert — either 401 (authn) or 403 (csrf) is an acceptable rejection
        expect(res.status).toBeGreaterThanOrEqual(400);
        const body = (await res.json());
        expect(['UNAUTHORIZED', 'FORBIDDEN']).toContain(body.error.code);
    });
});
//# sourceMappingURL=auth.logout.test.js.map