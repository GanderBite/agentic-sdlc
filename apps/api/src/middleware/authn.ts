import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';

import { verifySessionToken } from '../modules/auth/tokens.js';
import { env } from '../shared/env.js';
import { UnauthorizedError } from '../shared/errors.js';

/**
 * Context key used to opt a route out of authn enforcement.
 *
 * Set this before the `authn` middleware runs to mark a route as public:
 *   `c.set('allowPublic', true)`
 *
 * Alternatively, register `authn` only on the sub-routers that require it
 * rather than on the root app, which is the preferred pattern.
 */
export const ALLOW_PUBLIC_KEY = 'allowPublic' as const;

/**
 * Authentication middleware.
 *
 * Reads the `session` HttpOnly cookie, verifies the HS256 JWT, and attaches
 * the decoded claims to context as both `user` (the full payload) and `userId`
 * (the string id, consumed by the `logger` middleware for log enrichment).
 *
 * If the cookie is absent or the JWT is expired / invalid:
 *   - Throws `UnauthorizedError` unless `c.get('allowPublic')` is `true`.
 *
 * Routes that are intentionally public (e.g. auth.login, health) should either
 *   a) set `c.set('allowPublic', true)` before this middleware runs, or
 *   b) mount `authn` only on the protected sub-router.
 */
export const authn: MiddlewareHandler = async (c, next) => {
  const token = getCookie(c, 'session');

  if (!token) {
    if (c.get(ALLOW_PUBLIC_KEY as 'allowPublic')) {
      await next();
      return;
    }
    throw new UnauthorizedError('No session cookie');
  }

  try {
    const claims = await verifySessionToken(token, env.JWT_SECRET);
    c.set('user', claims);
    c.set('userId', claims.userId);
  } catch {
    if (c.get(ALLOW_PUBLIC_KEY as 'allowPublic')) {
      await next();
      return;
    }
    throw new UnauthorizedError('Invalid or expired session');
  }

  await next();
};
