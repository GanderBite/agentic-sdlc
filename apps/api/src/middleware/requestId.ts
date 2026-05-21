import type { Context, Next } from 'hono';

import { newUuid } from '../shared/ids.js';

/**
 * Middleware: requestId
 *
 * Mints a UUID for each incoming request, stores it on the context via
 * `c.set('requestId', ...)`, and echoes it back to the caller in the
 * `X-Request-Id` response header.
 *
 * This must be the first middleware registered on the root Hono app so that
 * every subsequent middleware (logger, errorHandler, …) can read the id from
 * context.
 */
export async function requestId(c: Context, next: Next): Promise<void> {
  const id = newUuid();
  c.set('requestId', id);
  c.header('X-Request-Id', id);
  await next();
}
