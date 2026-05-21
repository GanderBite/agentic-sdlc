import type { Context } from 'hono';
import type { Logger } from 'pino';
import { ZodError } from 'zod';

import { AppError, ValidationError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

/**
 * Hono `onError` handler — the single place where all thrown errors are
 * converted to the uniform `{ error: { code, message, details? } }` JSON
 * envelope defined in packages/contracts/src/auth.ts.
 *
 * Mapping rules:
 *  - AppError subclasses → use `error.code` and `error.status`; include
 *    `details` when present.
 *  - ZodError → ValidationError shape (422) with the Zod issues as `details`.
 *  - Unknown errors → 500 INTERNAL; the raw error is logged but never leaked
 *    to the caller.
 */
export function errorHandler(err: unknown, c: Context): Response {
  const requestId = (c.get('requestId') as string | undefined) ?? 'unknown';
  const log = (c.get('log') as Logger | undefined) ?? null;

  // ── AppError (our typed hierarchy) ───────────────────────────────────────
  if (err instanceof AppError) {
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      },
      err.status as Parameters<typeof c.json>[1],
    );
  }

  // ── Zod validation error (e.g. from a schema.parse call inside a service) ─
  if (err instanceof ZodError) {
    const ve = new ValidationError('Validation failed', err.issues);
    return c.json(
      {
        error: {
          code: ve.code,
          message: ve.message,
          details: ve.details,
        },
      },
      422,
    );
  }

  // ── Unknown / unexpected errors ──────────────────────────────────────────
  (log ?? logger).error({ err, requestId }, 'Unhandled error');

  return c.json(
    {
      error: {
        code: 'INTERNAL',
        message: 'Internal server error',
      },
    },
    500,
  );
}
