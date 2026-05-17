/**
 * main.ts — Hono application bootstrap.
 *
 * Entry point for the @medbridge/api server.
 *
 * Module order is deliberate:
 *  1. loadEnv is called first so missing/invalid env vars cause an immediate
 *     crash before any module side-effects run (acceptance bullet 10).
 *  2. env.ts caches the parsed env on first import, so every downstream module
 *     that imports `env` from './shared/env.js' observes the same singleton.
 *  3. auth routes apply csrf + authn per-route (see modules/auth/routes.ts), so
 *     the /api sub-router does NOT re-add them globally — that would double-apply
 *     the middleware on routes that already gate themselves.
 */

// --- Fail-fast env validation (MUST be first) --------------------------------
import { loadEnv } from './shared/env.js';

const env = loadEnv(process.env);

// --- External packages -------------------------------------------------------
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

// --- Internal modules (observe the cached env singleton) ---------------------
import { pool } from './db/client.js';
import { errorHandler } from './middleware/errorHandler.js';
import { logger as loggerMiddleware } from './middleware/logger.js';
import { requestId } from './middleware/requestId.js';
import { createAuthService, wireAuth } from './modules/auth/index.js';
import { defaultPasswordHasher } from './modules/auth/passwords.js';
import * as repo from './modules/auth/repo.js';
import { logger } from './shared/logger.js';

// ---------------------------------------------------------------------------
// Application factory — exported so integration tests can construct the app
// without binding a port (acceptance bullet 2).
// ---------------------------------------------------------------------------

export function buildApp(_env: typeof env): Hono {
  const app = new Hono();

  // ---- Global middleware (order: requestId → logger → cors → errorHandler) --
  app.use('*', requestId);
  app.use('*', loggerMiddleware);
  const corsOrigins = _env.CORS_ORIGIN.split(',').map((o) => o.trim());
  app.use(
    '*',
    cors({
      origin: (origin) => (corsOrigins.includes(origin) ? origin : null),
      credentials: true,
    }),
  );
  app.onError(errorHandler);

  // ---- Unauthenticated health check (ARCHITECTURE §6.1) --------------------
  app.get('/api/health', (c) => c.json({ ok: true }));

  // ---- Auth module ----------------------------------------------------------
  // csrf + authn are applied per-route inside modules/auth/routes.ts so we
  // mount wireAuth directly on the root app to avoid double-gating.
  const clock = { now: (): Date => new Date() };

  const authService = createAuthService({
    repo,
    hasher: defaultPasswordHasher,
    clock,
    logger,
  });

  wireAuth(app, { service: authService });

  return app;
}

// ---------------------------------------------------------------------------
// Side-effect entry — only runs when this file is the process entry point.
// Skipped during test imports so no port is bound.
// ---------------------------------------------------------------------------

if (process.env.NODE_ENV !== 'test') {
  const app = buildApp(env);
  const port = Number(process.env.PORT ?? 3000);

  const server: ServerType = serve({ fetch: app.fetch, port }, (info) => {
    logger.info({ port: info.port }, 'listening');
  });

  const shutdown = (): void => {
    logger.info('shutting down');
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
