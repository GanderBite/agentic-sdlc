/**
 * auth/index.ts — Public surface for the auth module.
 *
 * Re-exports the service factory and provides the `wireAuth` helper that
 * mounts all auth routes onto a caller-supplied Hono router.
 *
 * Consumers (e.g. app.ts) should import only from this file, never from
 * routes.ts, service.ts, repo.ts, etc. directly.
 */

import type { Hono } from 'hono';

import { type AuthRouteDeps, createAuthRouter } from './routes.js';

export { createAuthService } from './service.js';
export type {
  AuthRepo,
  AuthService,
  AuthServiceOptions,
  LoginResult,
  MeResult,
} from './service.js';

/**
 * Mount all auth routes onto `router`.
 *
 * The routes are registered under the router's root; the caller is responsible
 * for mounting the router at the correct prefix (e.g. `/v1`) in app.ts.
 *
 * @param router - The Hono instance to mount routes onto.
 * @param deps   - Auth route dependencies (the auth service instance).
 */
export function wireAuth(router: Hono, deps: AuthRouteDeps): void {
  const authRouter = createAuthRouter(deps);
  router.route('/', authRouter);
}
