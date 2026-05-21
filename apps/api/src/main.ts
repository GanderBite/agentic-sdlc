/**
 * main.ts — Hono application composition and HTTP server bootstrap.
 *
 * Exports `buildApp(env)` for integration tests (no port binding).
 * The module entry point calls loadEnv first, then builds the app and
 * starts @hono/node-server on PORT (default 3000).
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { errorHandler } from './middleware/errorHandler.js';
import { logger as loggerMiddleware } from './middleware/logger.js';
import { requestId as requestIdMiddleware } from './middleware/requestId.js';
import { createAuthService, wireAuth } from './modules/auth/index.js';
import { defaultPasswordHasher } from './modules/auth/passwords.js';
import * as authRepo from './modules/auth/repo.js';
import type { Env } from './shared/env.js';
import { loadEnv } from './shared/env.js';
import { logger } from './shared/logger.js';
import { defaultClock } from './shared/time.js';

// ---------------------------------------------------------------------------
// App factory — callable by integration tests without binding a port.
// ---------------------------------------------------------------------------

export function buildApp(_env: Env): Hono {
  const app = new Hono();

  // ── Global middleware (order: requestId → logger → cors → errorHandler) ──
  app.use('*', requestIdMiddleware);
  app.use('*', loggerMiddleware);
  app.use('*', cors({ origin: '*', credentials: false }));

  // ── Unauthenticated health check (ARCHITECTURE §6.1) ─────────────────────
  app.get('/api/health', (c) => c.json({ ok: true }, 200));

  // ── Protected /api/* router ───────────────────────────────────────────────
  const apiRouter = new Hono();

  // csrf and authn are NOT registered globally here.
  // Per-route middleware is declared in routes.ts:
  //   auth.logout  — csrf + authn
  //   auth.me      — authn
  //   auth.login   — public (no middleware)
  //   auth.refresh — public (no middleware)

  // Wire the auth module.
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

  // ── Error handler (last) ──────────────────────────────────────────────────
  app.onError(errorHandler);

  return app;
}

// ---------------------------------------------------------------------------
// Module entry point — side-effect: starts the HTTP server.
// Not executed when the module is imported by tests.
// ---------------------------------------------------------------------------

const _env = loadEnv(process.env);
const _app = buildApp(_env);
const port = Number(process.env.PORT ?? 3000);

const server = serve({ fetch: _app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  logger.info({ port: info.port }, 'listening');
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    logger.info({ sig }, 'shutting down');
    server.close(async () => {
      const { closeDb } = await import('./db/client.js');
      await closeDb();
      process.exit(0);
    });
  });
}
