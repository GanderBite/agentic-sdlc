import { timingSafeEqual } from 'node:crypto';

import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';

import { ForbiddenError } from '../shared/errors.js';

/** HTTP methods that mutate state and therefore require CSRF validation. */
const STATE_CHANGING_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);

/**
 * Middleware: csrf
 *
 * Implements the CSRF double-submit cookie pattern (ARCHITECTURE §5.4):
 *
 *   1. On state-changing requests (POST, PATCH, DELETE, PUT) read the
 *      `csrf_token` cookie value and the `X-CSRF-Token` request header.
 *   2. Compare them with `crypto.timingSafeEqual` to prevent timing attacks.
 *   3. Mismatch or missing values → ForbiddenError (403).
 *   4. GET / HEAD / OPTIONS are fully exempt.
 *
 * The `csrf_token` cookie is set as non-HttpOnly so the browser SPA can read
 * it and echo it in the header (see shared/http.ts `csrfCookieOptions`).
 */
export async function csrf(c: Context, next: Next): Promise<void> {
  if (!STATE_CHANGING_METHODS.has(c.req.method)) {
    await next();
    return;
  }

  const cookieValue = getCookie(c, 'csrf_token');
  const headerValue = c.req.header('X-CSRF-Token');

  if (!cookieValue || !headerValue) {
    throw new ForbiddenError('CSRF token missing');
  }

  // timingSafeEqual requires both buffers to be the same byte length.
  // If they differ in length the tokens are definitionally unequal.
  const cookieBuf = Buffer.from(cookieValue, 'utf8');
  const headerBuf = Buffer.from(headerValue, 'utf8');

  if (cookieBuf.length !== headerBuf.length || !timingSafeEqual(cookieBuf, headerBuf)) {
    throw new ForbiddenError('CSRF token mismatch');
  }

  await next();
}
