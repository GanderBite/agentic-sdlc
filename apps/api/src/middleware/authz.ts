import type { MiddlewareHandler } from 'hono';

import { ForbiddenError, UnauthorizedError } from '../shared/errors.js';

/**
 * Roles that can be asserted via `requireRole`.
 */
export type Role = 'patient' | 'doctor';

/**
 * Returns a Hono middleware that asserts the authenticated user has one of the
 * specified roles.
 *
 * Must be composed after `authn` — it reads `ctx.user` which `authn` populates.
 * Throws `UnauthorizedError` if no user is attached (authn was skipped).
 * Throws `ForbiddenError` if the user's role does not match.
 *
 * @example
 *   router.post('/slots', requireRole('doctor'), csrf, handler)
 */
export function requireRole(...roles: readonly Role[]): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get('user');

    if (user === undefined || user === null) {
      throw new UnauthorizedError('Authentication required');
    }

    const userRole = user.role as string;
    const allowed = (roles as readonly string[]).includes(userRole);

    if (!allowed) {
      throw new ForbiddenError(
        `Role '${userRole}' is not permitted. Required: ${roles.join(' | ')}`,
      );
    }

    await next();
  };
}
