import type { MiddlewareHandler } from 'hono';

import { logger as rootLogger } from '../shared/logger.js';

/**
 * logger middleware
 *
 * Creates a pino child logger bound to the current request (requestId, method,
 * path) and attaches it to ctx as `log`. Emits one structured line per request
 * on response close containing: requestId, method, path, status, durationMs,
 * and userId (when the user is already set on context).
 */
export const logger: MiddlewareHandler = async (c, next): Promise<void> => {
  const startMs = Date.now();
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;
  const requestId = (c.get('requestId') as string | undefined) ?? 'unknown';

  const child = rootLogger.child({ requestId, method, path });
  c.set('log', child);

  await next();

  const durationMs = Date.now() - startMs;
  const status = c.res.status;
  const userId = (c.get('user') as { id?: string } | undefined)?.id;

  const logEntry: Record<string, unknown> = {
    requestId,
    method,
    path,
    status,
    durationMs,
  };

  if (userId !== undefined) {
    logEntry['userId'] = userId;
  }

  child.info(logEntry, 'request.complete');
};
