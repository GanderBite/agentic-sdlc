/**
 * app.ts — Hono application factory
 *
 * Builds and returns a configured Hono instance with:
 *   - Middleware chain: requestId → logger → csrf
 *   - GET /api/health — no auth, no csrf (GET is always csrf-exempt)
 *   - Auth module routes mounted at /api
 *   - Global error handler via app.onError
 */
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";

import type { AuthService } from "./modules/auth/index.js";
import { createAuthRoutes } from "./modules/auth/routes.js";
import { requestId } from "./middleware/requestId.js";
import { logger } from "./middleware/logger.js";
import { csrf } from "./middleware/csrf.js";
import { errorHandler } from "./middleware/errorHandler.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateAppDeps = {
  /** Live auth service instance. */
  readonly service: AuthService;
  /**
   * The authn middleware to inject into auth routes (e.g. GET /me).
   * Kept injectable so tests can supply a stub without a real JWT_SECRET.
   */
  readonly authn: MiddlewareHandler;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates and returns a fully-wired Hono application.
 *
 * Middleware order: requestId → logger → csrf → (per-route authn where needed).
 * The auth router is mounted at `/api` so paths become:
 *   POST /api/login, POST /api/refresh, POST /api/logout, GET /api/me.
 */
export function createApp({ service, authn }: CreateAppDeps): Hono {
  const app = new Hono();

  // ---- Global middleware -----------------------------------------------
  // requestId must run first so all downstream middleware can read it.
  app.use("*", requestId);
  // Structured per-request logger (reads requestId set above).
  app.use("*", logger);
  // CSRF double-submit protection. GET/HEAD/OPTIONS and exempt paths are
  // skipped internally by the csrf middleware.
  app.use("*", csrf);

  // ---- Health check -------------------------------------------------------
  // Registered BEFORE auth routes. No auth required. CSRF is a no-op on GET.
  app.get("/api/health", (c) => c.json({ ok: true }));

  // ---- Auth module routes -------------------------------------------------
  // Mounted at /api so paths are /api/login, /api/refresh, /api/logout, /api/me.
  app.route("/api", createAuthRoutes({ service, authn }));

  // ---- Error handler ------------------------------------------------------
  app.onError(errorHandler);

  return app;
}
