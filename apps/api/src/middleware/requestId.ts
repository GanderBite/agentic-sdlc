import { randomUUID } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';

/**
 * Mints a UUID v4 per request, attaches it to `ctx` as `requestId`,
 * and reflects it back to the caller via the `X-Request-Id` response header.
 *
 * Must be the first middleware registered on the root app.
 */
export const requestId: MiddlewareHandler = async (c, next) => {
  const id = randomUUID();
  c.set('requestId', id);
  await next();
  c.res.headers.set('X-Request-Id', id);
};
