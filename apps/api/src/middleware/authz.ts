import type { Context, MiddlewareHandler, Next } from 'hono';

import type { SessionClaims } from '../modules/auth/tokens.js';
import { ForbiddenError, UnauthorizedError } from '../shared/errors.js';

/** Roles supported by the RBAC system. */
export type AllowedRole = 'patient' | 'doctor';

/**
 * Middleware factory: requireRole
 *
 * Returns a Hono middleware that checks `ctx.user.role` matches one of the
 * specified roles.  Must run after the `authn` middleware so that `ctx.user`
 * is already populated.
 *
 * Throws:
 *  - `UnauthorizedError` (401) when no user claim is present on the context
 *    (the request somehow bypassed authn).
 *  - `ForbiddenError` (403) when the user's role is not in `roles`.
 *
 * Usage:
 *   router.use('/patient-only/*', requireRole('patient'));
 *   router.use('/doctor-only/*', requireRole('doctor', 'patient'));
 */
export function requireRole(...roles: readonly [AllowedRole, ...AllowedRole[]]): MiddlewareHandler {
  return async (c: Context, next: Next): Promise<void> => {
    const user = c.get('user') as SessionClaims | undefined;

    if (!user) {
      throw new UnauthorizedError('Authentication required');
    }

    const allowed = (roles as readonly string[]).includes(user.role);
    if (!allowed) {
      throw new ForbiddenError(`Role '${user.role}' is not permitted to access this resource`);
    }

    await next();
  };
}
