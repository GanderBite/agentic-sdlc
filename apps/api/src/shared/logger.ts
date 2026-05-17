import pino from 'pino';

import { env } from './env.js';

/**
 * Paths that pino will censor with '[REDACTED]'.
 *
 * Audited against middleware/logger.ts output, which emits:
 *   { requestId, method, path, status, durationMs, userId? }
 *
 * Real exposure vectors are request headers that carry cookies (refresh token +
 * CSRF token values) and set-cookie response headers.  Dead paths that no log
 * line ever produces (req.body.*, *.token, *.refreshToken, *.csrfToken, *.jwt)
 * have been removed to avoid giving false assurance.
 */
export const REDACT_PATHS: readonly string[] = [
  'req.headers.cookie',
  "req.headers['set-cookie']",
  "req.headers['x-csrf-token']",
  '*.password',
] as const;

export function createLogger(opts?: {
  level?: string;
  destination?: pino.DestinationStream;
}): pino.Logger {
  const level = opts?.level ?? env.LOG_LEVEL;
  const pinoOpts: pino.LoggerOptions = {
    level,
    redact: {
      paths: REDACT_PATHS as string[],
      censor: '[REDACTED]',
    },
  };

  return opts?.destination ? pino(pinoOpts, opts.destination) : pino(pinoOpts);
}

export const logger: pino.Logger = createLogger();

export function withRequestId(requestId: string, userId?: string): pino.Logger {
  const bindings: { requestId: string; userId?: string } = { requestId };
  if (userId !== undefined) {
    bindings.userId = userId;
  }
  return logger.child(bindings);
}
