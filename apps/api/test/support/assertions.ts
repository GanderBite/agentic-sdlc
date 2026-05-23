/**
 * assertions.ts — uniform AppError-envelope assertions for integration tests
 *
 * Usage:
 *
 *   import { expectAppError } from "./assertions.js";
 *   await expectAppError(res, "UNAUTHORIZED");
 */
import { expect } from "vitest";

import type { ErrorCode } from "@medbridge/contracts";

// ---------------------------------------------------------------------------
// Status-code map
// ---------------------------------------------------------------------------

/**
 * HTTP status codes for each ErrorCode in the AppError taxonomy.
 *
 * Grounded in `apps/api/src/shared/errors.ts`:
 *   ValidationError     → 422
 *   UnauthorizedError   → 401
 *   ForbiddenError      → 403
 *   NotFoundError       → 404
 *   ConflictError       → 409
 *   TooManyRequestsError→ 429
 *   UnsupportedMediaError→ 415
 *   PayloadTooLargeError → 413
 *
 * The CSRF middleware throws ForbiddenError (403) for CSRF failures.
 * The errorHandler also emits 500 for unhandled errors (code "INTERNAL").
 */
const STATUS_FOR_CODE = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  TOO_MANY_REQUESTS: 429,
  VALIDATION: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNSUPPORTED_MEDIA: 415,
  PAYLOAD_TOO_LARGE: 413,
} as const satisfies Record<ErrorCode, number>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assert that a `Response` carries the expected AppError envelope.
 *
 * Checks:
 *   1. `res.status` matches the canonical HTTP status for `code`.
 *   2. JSON body has shape `{ error: { code } }` where `error.code === code`.
 *
 * @param res  - The Response object returned by the request helper or `app.fetch`.
 * @param code - The `ErrorCode` enum value that should appear in the response body.
 */
export async function expectAppError(res: Response, code: ErrorCode): Promise<void> {
  const expectedStatus = STATUS_FOR_CODE[code];

  expect(res.status, `expected HTTP ${expectedStatus} for error code "${code}" but got ${res.status}`).toBe(expectedStatus);

  // Clone before consuming the body so callers can read it too if needed.
  const body: unknown = await res.clone().json();

  expect(
    body,
    `expected JSON body to have shape { error: { code: "${code}" } }`,
  ).toMatchObject({
    error: {
      code,
    },
  });
}
