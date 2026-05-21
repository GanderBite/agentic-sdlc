/**
 * auth.log-scrub.test.ts
 *
 * Adversarial smoke: verifies that no sensitive values (plaintext password,
 * session JWT, raw refresh cookie, CSRF token) appear in any captured log line
 * across the full login → refresh → me → logout flow.
 *
 * Strategy: build a pino logger wired to createLogCapture() and inject it as
 * the child logger for the auth service. After running the flow, call
 * capture.notContainsAny([...secrets]).
 *
 * Acceptance bullet 8.
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
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
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
let container;
let pool;
let db;
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
async function seedUsers() {
    const hash = await defaultPasswordHasher.hash(SEED_PLAIN_PASSWORD);
    await db.insert(user).values([
        { email: 'patient@test.local', role: 'patient', passwordHash: hash },
        { email: 'doctor@test.local', role: 'doctor', passwordHash: hash },
    ]);
}
async function truncate() {
    await pool.query('TRUNCATE TABLE refresh_token, "user" RESTART IDENTITY CASCADE');
}
// ---------------------------------------------------------------------------
// Test-pool repo adapter
// ---------------------------------------------------------------------------
function makeTestRepo() {
    return {
        async findUserByEmail(email) {
            const rows = await db.select().from(user).where(eq(user.email, email)).limit(1);
            const first = rows[0];
            if (first === undefined || first.deletedAt !== null)
                return undefined;
            return first;
        },
        async findUserById(id) {
            const rows = await db.select().from(user).where(eq(user.id, id)).limit(1);
            const first = rows[0];
            if (first === undefined || first.deletedAt !== null)
                return undefined;
            return first;
        },
        async insertRefreshToken(input) {
            const rows = await db
                .insert(refreshToken)
                .values({ userId: input.userId, hash: input.hash, expiresAt: input.expiresAt })
                .returning();
            const row = rows[0];
            if (row === undefined)
                throw new Error('insertRefreshToken: no row returned');
            return row;
        },
        async rotateRefreshToken(hash) {
            const result = await db.execute(sql `UPDATE refresh_token SET revoked_at = now() WHERE hash = ${hash} AND revoked_at IS NULL RETURNING id, user_id, expires_at`);
            const row = result.rows[0];
            if (row === undefined)
                return null;
            return { id: row.id, userId: row.user_id, expiresAt: row.expires_at };
        },
        async findRefreshTokenAnywhere(hash) {
            const rows = await db.select().from(refreshToken).where(eq(refreshToken.hash, hash)).limit(1);
            return rows[0];
        },
        async revokeAllActiveForUser(userId) {
            await db.execute(sql `UPDATE refresh_token SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`);
        },
    };
}
// ---------------------------------------------------------------------------
// Build the Hono app with a captured logger.
// Note: auth.login and auth.refresh are documented as CSRF-exempt.
// The apiRouter here omits the global CSRF middleware so those routes are
// reachable without a pre-existing csrf_token cookie.
// ---------------------------------------------------------------------------
function buildTestApp(capturedLogger) {
    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.use('*', loggerMiddleware);
    app.use('*', cors({ origin: '*', credentials: false }));
    app.get('/api/health', (c) => c.json({ ok: true }, 200));
    const apiRouter = new Hono();
    // No global authn/csrf — auth.login and auth.refresh are exempt (they
    // bootstrap the session). auth.logout and auth.me enforce auth per-route
    // via inline middleware in routes.ts.
    const authService = createAuthService({
        repo: makeTestRepo(),
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
// Tests
// ---------------------------------------------------------------------------
describe('auth.log-scrub', () => {
    let agent;
    const capture = createLogCapture();
    const capturedLogger = createCapturedLogger(capture);
    beforeEach(async () => {
        capture.clear();
        await truncate();
        await seedUsers();
        agent = createRequestAgent(buildTestApp(capturedLogger));
        agent.reset();
    });
    it('when login → refresh → me → logout flow is executed, then no log line contains plaintext password, session JWT, raw refresh token, or csrf_token value', async () => {
        // act — step 1: login
        const loginRes = await agent.fetch('/api/auth.login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'patient@test.local', password: SEED_PLAIN_PASSWORD }),
        });
        expect(loginRes.status).toBe(200);
        // Capture sensitive token values from Set-Cookie headers.
        const setCookies = loginRes.headers.getSetCookie?.() ?? [];
        let sessionJwtRaw = '';
        let refreshCookieRaw = '';
        let csrfTokenRaw = '';
        for (const rawCookie of setCookies) {
            const firstPart = rawCookie.split(';')[0] ?? '';
            const eqIdx = firstPart.indexOf('=');
            if (eqIdx === -1)
                continue;
            const name = firstPart.slice(0, eqIdx).trim();
            const val = firstPart.slice(eqIdx + 1).trim();
            if (name === 'session')
                sessionJwtRaw = val;
            if (name === 'refresh')
                refreshCookieRaw = val;
            if (name === 'csrf_token')
                csrfTokenRaw = val;
        }
        // The values must be non-empty for the assertion to be meaningful.
        expect(sessionJwtRaw.length).toBeGreaterThan(0);
        expect(refreshCookieRaw.length).toBeGreaterThan(0);
        expect(csrfTokenRaw.length).toBeGreaterThan(0);
        // act — step 2: refresh (agent cookie jar carries the tokens automatically)
        const refreshRes = await agent.fetch('/api/auth.refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(refreshRes.status).toBe(200);
        // act — step 3: me (GET, no CSRF required)
        const meRes = await agent.fetch('/api/auth.me', { method: 'GET' });
        expect(meRes.status).toBe(200);
        // act — step 4: logout (agent auto-injects CSRF from cookie jar)
        const logoutRes = await agent.fetch('/api/auth.logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(logoutRes.status).toBe(200);
        // assert — no captured log line contains any sensitive value
        const secrets = [
            SEED_PLAIN_PASSWORD,
            sessionJwtRaw,
            refreshCookieRaw,
            csrfTokenRaw,
        ];
        capture.notContainsAny(secrets);
    });
});
//# sourceMappingURL=auth.log-scrub.test.js.map