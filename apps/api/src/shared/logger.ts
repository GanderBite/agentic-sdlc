import pino from 'pino';

import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'req.body.password',
      '*.password',
      '*.token',
      '*.refreshToken',
      '*.csrfToken',
      '*.jwt',
    ],
    censor: '[REDACTED]',
  },
});

export function withRequestId(requestId: string, userId?: string): pino.Logger {
  return logger.child({
    requestId,
    ...(userId !== undefined ? { userId } : {}),
  });
}
