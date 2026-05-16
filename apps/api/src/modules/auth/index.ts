/**
 * Auth module public surface.
 *
 * Consumers should import from here rather than from the individual
 * implementation files to keep the module layering boundary clean.
 *
 * Exports:
 *   createAuthService — factory for the auth business-logic service.
 *   wireAuth          — mounts the auth Hono routes onto an existing router.
 */

import type { Hono } from 'hono';

import { createAuthRouter } from './routes.js';
import type { AuthRouteDeps } from './routes.js';

export { createAuthService } from './service.js';
export type { AuthService, AuthServiceDeps, LoginResult, UserResult } from './service.js';

/**
 * Mounts all auth RPC routes onto `router` under the provided deps.
 *
 * Typical usage in app.ts:
 * ```ts
 * import { wireAuth } from './modules/auth/index.js';
 * wireAuth(app, { service: authService });
 * ```
 *
 * @param router - The root Hono app (or any sub-app) to mount routes onto.
 * @param deps   - `{ service: AuthService }` — the wired-up auth service instance.
 */
// biome-ignore lint/suspicious/noExplicitAny: router accepts any Hono instance at the mount site
export function wireAuth(router: Hono<any>, deps: AuthRouteDeps): void {
  const authRouter = createAuthRouter(deps);
  router.route('/', authRouter);
}
