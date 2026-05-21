import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';

import { verifySessionToken } from '../modules/auth/tokens.js';
import { env } from '../shared/env.js';
import { UnauthorizedError } from '../shared/errors.js';

/**
 * Context property key used by route handlers to mark a route as publicly
 * accessible (no authentication required).
 *
 * Usage — set before this middleware runs, typically in the route definition:
 *   c.set('allowPublic', true);
 *
 * The middleware skips the token check when this flag is truthy.
 */
export const ALLOW_PUBLIC_KEY = 'allowPublic' as const;

/**
 * Middleware: authn
 *
 * Reads the `session` HttpOnly cookie, verifies it as a HS256 JWT using the
 * shared `verifySessionToken` helper, and attaches the parsed claims to the
 * context as `c.set('user', claims)`.
 *
 * If the cookie is absent or the JWT is invalid/expired this middleware throws
 * `UnauthorizedError` (401) — UNLESS the route has opted out of authentication
 * by setting `c.set('allowPublic', true)` before this middleware executes
 * (e.g. auth.login and auth.refresh routes).
 */
export async function authn(c: Context, next: Next): Promise<void> {
  const isPublic = c.get(ALLOW_PUBLIC_KEY) as boolean | undefined;

  const sessionCookie = getCookie(c, 'session');

  if (!sessionCookie) {
    if (isPublic) {
      await next();
      return;
    }
    throw new UnauthorizedError('Session cookie missing');
  }

  try {
    const claims = await verifySessionToken(sessionCookie, env.JWT_SECRET);
    c.set('user', claims);
  } catch {
    if (isPublic) {
      await next();
      return;
    }
    throw new UnauthorizedError('Session invalid or expired');
  }

  await next();
}
