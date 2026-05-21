import type { Context, Next } from 'hono';

import { withRequestId } from '../shared/logger.js';

/**
 * Middleware: logger
 *
 * Opens a pino child logger bound to the current requestId (and optionally
 * userId when available) and stores it on context as `c.set('log', child)`.
 *
 * Emits one structured log line per request after the response is produced:
 *   { requestId, method, path, status, durationMs, userId? }
 *
 * Depends on requestId middleware having already run (reads `c.get('requestId')`).
 */
export async function logger(c: Context, next: Next): Promise<void> {
  const requestId = (c.get('requestId') as string | undefined) ?? 'unknown';
  const startMs = Date.now();

  // Attach the child logger before the handler runs so downstream code can use it.
  const log = withRequestId(requestId);
  c.set('log', log);

  await next();

  // After the response is produced the user claim may have been set by authn.
  const userId = (c.get('user') as { userId?: string } | undefined)?.userId;
  const emitLog = userId ? log.child({ userId }) : log;

  emitLog.info(
    {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - startMs,
    },
    'request.complete',
  );
}
