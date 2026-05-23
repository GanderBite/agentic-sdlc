import type { Role } from '@medbridge/contracts';
import type { MiddlewareHandler } from 'hono';

import { ForbiddenError } from '../shared/errors.js';

/**
 * requireRole factory
 *
 * Returns a Hono middleware that allows only requests whose `ctx.user.role`
 * is one of the provided `roles`. Any other role (or a missing user) throws
 * ForbiddenError (403).
 *
 * Intended to be composed after the `authn` middleware so `ctx.user` is
 * guaranteed to be set by the time this guard runs.
 *
 * Example:
 *   router.get("/admin", authn, requireRole("doctor"), handler);
 */
export function requireRole(...roles: readonly [Role, ...Role[]]): MiddlewareHandler {
  const allowed = new Set<string>(roles);

  return async (c, next): Promise<void> => {
    const user = c.get('user') as { id: string; email: string; role: string } | undefined;

    if (user === undefined) {
      throw new ForbiddenError('Authentication required');
    }

    if (!allowed.has(user.role)) {
      throw new ForbiddenError(`Role '${user.role}' is not permitted`);
    }

    await next();
  };
}
