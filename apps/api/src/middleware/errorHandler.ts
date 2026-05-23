import type { ErrorHandler } from "hono";

import { AppError } from "../shared/errors.js";
import { logger } from "../shared/logger.js";

/**
 * errorHandler
 *
 * Top-level Hono onError handler. Maps thrown errors to a uniform JSON
 * envelope: `{ error: { code, message?, details? } }`.
 *
 *   - AppError subclasses → their own statusCode + code + message + details
 *   - Everything else    → 500 with code "INTERNAL" (details omitted)
 */
export const errorHandler: ErrorHandler = (err, c): Response => {
  if (err instanceof AppError) {
    const body: {
      error: {
        code: string;
        message?: string;
        details?: unknown;
      };
    } = {
      error: {
        code: err.code,
        message: err.message,
      },
    };

    if (err.details !== undefined) {
      body.error.details = err.details;
    }

    return c.json(body, err.statusCode as Parameters<typeof c.json>[1]);
  }

  // Unknown / unexpected error — log it and return a generic 500.
  const requestId = (c.get("requestId") as string | undefined) ?? "unknown";
  logger.error({ err, requestId }, "Unhandled error");

  return c.json({ error: { code: "INTERNAL" } }, 500);
};
