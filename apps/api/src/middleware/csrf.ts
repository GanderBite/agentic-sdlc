import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

import { getCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";

import { ForbiddenError } from "../shared/errors.js";

/** HTTP methods that mutate state and require a CSRF check. */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Routes that are exempt from CSRF validation even when using unsafe methods.
 * These are endpoints that issue session cookies and therefore cannot yet carry
 * a CSRF token (login, token refresh).
 */
const EXEMPT_PATHS = new Set(["/v1/auth/login", "/v1/auth/refresh"]);

/**
 * csrf middleware
 *
 * Skips GET / HEAD / OPTIONS and paths in the exempt list. For all other
 * methods compares the `csrf_token` cookie value to the `X-CSRF-Token` request
 * header using constant-time comparison. A mismatch throws ForbiddenError (403).
 */
export const csrf: MiddlewareHandler = async (c, next): Promise<void> => {
  const method = c.req.method;

  if (!UNSAFE_METHODS.has(method)) {
    await next();
    return;
  }

  const path = new URL(c.req.url).pathname;

  if (EXEMPT_PATHS.has(path)) {
    await next();
    return;
  }

  const cookieToken = getCookie(c, "csrf_token");
  const headerToken = c.req.header("X-CSRF-Token");

  if (
    cookieToken === undefined ||
    cookieToken === "" ||
    headerToken === undefined ||
    headerToken === ""
  ) {
    throw new ForbiddenError("CSRF token missing");
  }

  const cookieBuf = Buffer.from(cookieToken, "utf8");
  const headerBuf = Buffer.from(headerToken, "utf8");

  // Lengths must match; if they differ the tokens cannot be equal and we must
  // still use timingSafeEqual to avoid leaking length information via timing.
  // We compare against equal-length buffers to satisfy the crypto API contract.
  const lengthsMatch = cookieBuf.length === headerBuf.length;

  // Use the shorter length as the safe comparison length when lengths differ —
  // the result is always "not equal" in that case, but no timing information
  // about the actual secret bytes is leaked.
  const safeLen = Math.min(cookieBuf.length, headerBuf.length);
  const safeA = cookieBuf.subarray(0, safeLen);
  const safeB = headerBuf.subarray(0, safeLen);

  const bytesMatch = safeLen > 0 && timingSafeEqual(safeA, safeB);

  if (!lengthsMatch || !bytesMatch) {
    throw new ForbiddenError("CSRF token mismatch");
  }

  await next();
};
