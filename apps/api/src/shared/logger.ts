import pino from 'pino';

import { env } from './env.js';

const REDACT_PATHS: readonly string[] = [
  'req.headers.cookie',
  "req.headers['x-csrf-token']",
  'req.body.password',
  '*.password',
  '*.token',
  '*.refreshToken',
  '*.csrfToken',
  '*.jwt',
] as const;

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: REDACT_PATHS as string[],
    censor: '[REDACTED]',
  },
});

export function withRequestId(requestId: string, userId?: string): pino.Logger {
  const bindings: { requestId: string; userId?: string } = { requestId };
  if (userId !== undefined) {
    bindings.userId = userId;
  }
  return logger.child(bindings);
}
