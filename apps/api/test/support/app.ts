/**
 * Test app factory.
 *
 * Exports buildTestApp() which constructs the production Hono app from
 * individual source modules — identical composition to buildApp() in
 * src/main.ts (requestId → logger → cors → apiRouter → errorHandler) — but
 * WITHOUT importing from src/main.ts directly.
 *
 * WHY not import buildApp from src/main.ts:
 *   src/main.ts contains an unconditional top-level serve() call that starts
 *   the HTTP server on port 3000. Importing that module in tests triggers the
 *   server bootstrap (EADDRINUSE across multiple test files). This is a
 *   production-code architectural issue (missing `if (import.meta.main)` guard
 *   or an app/server split) that requires a separate fix (F-009/F-010 or
 *   equivalent). Until that fix lands, this helper mirrors buildApp()'s
 *   composition by importing each piece individually.
 *
 * IMPORTANT: buildTestApp() uses dynamic imports internally so that all
 * production modules are resolved AFTER process.env.DATABASE_URL (and other
 * env vars) have been set by the calling test's beforeAll. The function MUST
 * be called after env vars are set; its return value is a Promise<Hono>.
 *
 * Usage (inside beforeAll, after env vars are set):
 *
 *   process.env.DATABASE_URL = testDb.container.getConnectionUri();
 *   process.env.JWT_SECRET   = 'test-jwt-secret-at-least-32-bytes-long!!';
 *   process.env.NODE_ENV     = 'test';
 *   const { buildTestApp } = await import('../support/app.js');
 *   app = await buildTestApp();
 */

import type { Hono } from 'hono';

/**
 * Build a Hono app using the production middleware order and the production
 * auth service wired to the production repo (which reads from the db singleton
 * that must point at the test container via DATABASE_URL).
 *
 * Middleware order mirrors src/main.ts buildApp():
 *   requestId → logger → cors → apiRouter(routes) → errorHandler
 *
 * Uses dynamic imports so that src/db/client.ts (and all its transitive
 * dependencies) are resolved after the calling beforeAll has set
 * process.env.DATABASE_URL to the test container's connection URI.
 *
 * Tests that need to inject a custom hasher, logger, or clock into the auth
 * service (auth.constant-time, auth.log-scrub, auth.token-family,
 * auth.concurrent-refresh) cannot use this helper and must construct their own
 * app with createAuthService + wireAuth directly, because buildApp() does not
 * expose those injection seams.
 */
export async function buildTestApp(): Promise<Hono> {
  const { Hono: HonoClass } = await import('hono');
  const { cors } = await import('hono/cors');

  const { errorHandler } = await import('../../src/middleware/errorHandler.js');
  const { logger: loggerMiddleware } = await import('../../src/middleware/logger.js');
  const { requestId: requestIdMiddleware } = await import('../../src/middleware/requestId.js');
  const { createAuthService, wireAuth } = await import('../../src/modules/auth/index.js');
  const { defaultPasswordHasher } = await import('../../src/modules/auth/passwords.js');
  const authRepo = await import('../../src/modules/auth/repo.js');
  const { logger } = await import('../../src/shared/logger.js');
  const { defaultClock } = await import('../../src/shared/time.js');

  const app = new HonoClass();

  // Global middleware — identical order to buildApp() in src/main.ts
  app.use('*', requestIdMiddleware);
  app.use('*', loggerMiddleware);
  app.use('*', cors({ origin: '*', credentials: false }));

  // Unauthenticated health check
  app.get('/api/health', (c) => c.json({ ok: true }, 200));

  // Protected /api/* router — per-route middleware declared in routes.ts
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

  // Error handler last — identical to buildApp()
  app.onError(errorHandler);

  return app;
}
