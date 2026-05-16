import type { MiddlewareHandler } from 'hono';

import { withRequestId } from '../shared/logger.js';

/**
 * Request-scoped structured logger middleware.
 *
 * Opens a child pino logger bound with `{ requestId, userId? }` and stores it
 * on `c` as `log`. After the handler resolves, emits one structured log line
 * per request: `{ requestId, method, path, status, durationMs, userId? }`.
 *
 * Depends on `requestId` middleware being registered first (reads `requestId`
 * from context).
 */
export const logger: MiddlewareHandler = async (c, next) => {
  const startMs = Date.now();
  const requestId = c.get('requestId') ?? 'unknown';

  // User may not be attached yet at middleware registration time; we capture
  // it lazily after `next()` resolves so the log line includes it when authn
  // runs downstream.
  const child = withRequestId(requestId);
  c.set('log', child);

  await next();

  const userId: string | undefined = c.get('userId');
  const log = userId ? withRequestId(requestId, userId) : child;

  log.info({
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - startMs,
    ...(userId !== undefined ? { userId } : {}),
  });
};
