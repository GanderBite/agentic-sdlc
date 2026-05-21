/**
 * Integration tests: auth.refresh
 *
 * REQUIRES: Docker daemon running on the host (testcontainers).
 *
 * Covers:
 *  - First call rotates: new refresh cookie differs from original; old hash row
 *    has revoked_at set; new active row exists.
 *  - Replaying the original refresh cookie after rotation returns 401.
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
let app;
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
    app = new HonoClass();
    app.use('*', requestId);
    app.use('*', loggerMw);
    app.use('*', cors({ origin: '*', credentials: false }));
    // Routes declare per-route middleware; no global csrf/authn needed.
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
async function loginAsPatient() {
    return agent.fetch('/api/auth.login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'patient@test.local', password: SEED_PLAIN_PASSWORD }),
    });
}
// ---------------------------------------------------------------------------
// Token rotation
// ---------------------------------------------------------------------------
describe('auth.refresh — token rotation', () => {
    it('when a valid refresh cookie is presented, rotates the token and returns new cookies', async () => {
        // arrange — log in to obtain initial tokens
        await insertSeedUsers(testDb.db);
        const loginRes = await loginAsPatient();
        expect(loginRes.status).toBe(200);
        const originalRefresh = extractCookieValue(loginRes, 'refresh');
        expect(originalRefresh).toBeDefined();
        // act — auth.refresh is public (no authn/csrf required)
        const refreshRes = await agent.fetch('/api/auth.refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        // assert — status 200
        expect(refreshRes.status).toBe(200);
        // assert — new refresh cookie value differs from original
        const newRefresh = extractCookieValue(refreshRes, 'refresh');
        expect(newRefresh).toBeDefined();
        expect(newRefresh).not.toBe(originalRefresh);
        // assert — body has user shape
        const body = (await refreshRes.json());
        expect(body).toMatchObject({
            user: {
                id: expect.any(String),
                email: 'patient@test.local',
                role: 'patient',
            },
        });
    });
    it('when the original refresh token is replayed after rotation, returns 401', async () => {
        // arrange — log in then rotate once
        await insertSeedUsers(testDb.db);
        const loginRes = await loginAsPatient();
        expect(loginRes.status).toBe(200);
        const originalRefresh = extractCookieValue(loginRes, 'refresh');
        expect(originalRefresh).toBeDefined();
        // First rotation — consumes the original refresh token; agent jar now has new token.
        const firstRefresh = await agent.fetch('/api/auth.refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(firstRefresh.status).toBe(200);
        // act — replay the original (now-revoked) refresh cookie.
        // Use a fresh agent so the main agent's jar (with the valid rotated token) does
        // not override the deliberately invalid replay cookie we're sending.
        const replayAgent = createRequestAgent(app);
        const replayRes = await replayAgent.fetch('/api/auth.refresh', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: `refresh=${originalRefresh ?? ''}`,
            },
            skipCsrf: true,
        });
        // assert — replay is rejected with 401
        expect(replayRes.status).toBe(401);
        const body = (await replayRes.json());
        expect(body.error.code).toBe('UNAUTHORIZED');
    });
    it('when refresh rotates, the old hash row has revoked_at set in the database', async () => {
        // arrange
        await insertSeedUsers(testDb.db);
        const loginRes = await loginAsPatient();
        expect(loginRes.status).toBe(200);
        const { refreshToken } = await import('../../src/db/schema.js');
        const { hashRefreshToken } = await import('../../src/modules/auth/tokens.js');
        const originalRefresh = extractCookieValue(loginRes, 'refresh');
        expect(originalRefresh).toBeDefined();
        const originalHash = await hashRefreshToken(originalRefresh ?? '');
        // act — rotate
        const refreshRes = await agent.fetch('/api/auth.refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(refreshRes.status).toBe(200);
        // assert — old row has revoked_at set
        const oldRows = await testDb.db
            .select()
            .from(refreshToken)
            .where(eq(refreshToken.hash, originalHash));
        expect(oldRows).toHaveLength(1);
        expect(oldRows[0]?.revokedAt).not.toBeNull();
        // assert — new row exists (active, not revoked) with a different hash
        const newRefresh = extractCookieValue(refreshRes, 'refresh');
        expect(newRefresh).toBeDefined();
        const newHash = await hashRefreshToken(newRefresh ?? '');
        expect(newHash).not.toBe(originalHash);
        const newRows = await testDb.db
            .select()
            .from(refreshToken)
            .where(eq(refreshToken.hash, newHash));
        expect(newRows).toHaveLength(1);
        expect(newRows[0]?.revokedAt).toBeNull();
    });
});
//# sourceMappingURL=auth.refresh.test.js.map