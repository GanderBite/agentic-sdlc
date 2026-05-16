import type { Context } from 'hono';
import { ZodError } from 'zod';

import { AppError, ValidationError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

/**
 * Uniform error response shape.
 */
type ErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

function buildBody(code: string, message: string, details?: unknown): ErrorBody {
  const error: ErrorBody['error'] = { code, message };
  if (details !== undefined) {
    error.details = details;
  }
  return { error };
}

/**
 * Hono `onError` handler.
 *
 * - `AppError` subclasses → JSON `{ error: { code, message, details? } }` at
 *   the error's own HTTP status.
 * - `ZodError` (escaped from a route without going through `zValidator`) →
 *   422 `ValidationError` with `issues` as `details`.
 * - Anything else → 500; the real error is logged at `error` level so it is
 *   visible in server logs without leaking internals to the client.
 */
export function errorHandler(err: unknown, c: Context): Response {
  // ---- AppError (covers all domain subclasses) ----------------------------
  if (err instanceof AppError) {
    return c.json(buildBody(err.code, err.message, err.details), err.status as 422);
  }

  // ---- Naked ZodError (belt-and-suspenders for routes without zValidator) -
  if (err instanceof ZodError) {
    const ve = new ValidationError('Validation failed', err.issues);
    return c.json(buildBody(ve.code, ve.message, ve.details), 422);
  }

  // ---- Unknown / unexpected -----------------------------------------------
  const requestId = c.get('requestId') ?? 'unknown';
  const log = c.get('log') ?? logger;

  log.error(
    {
      requestId,
      err,
    },
    'Unhandled error',
  );

  return c.json(buildBody('INTERNAL', 'An unexpected error occurred'), 500);
}
