import { timingSafeEqual } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';

import { ForbiddenError } from '../shared/errors.js';

/**
 * Methods that mutate server state and therefore require CSRF protection.
 */
const STATE_CHANGING_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);

/**
 * CSRF double-submit cookie middleware.
 *
 * For every state-changing request (POST / PATCH / DELETE / PUT):
 *   1. Reads the `csrf_token` cookie value.
 *   2. Reads the `X-CSRF-Token` request header.
 *   3. Compares them with `crypto.timingSafeEqual` to prevent timing attacks.
 *
 * If either value is absent or they do not match, throws `ForbiddenError`.
 * GET / HEAD / OPTIONS requests pass through unconditionally.
 *
 * The CSRF cookie (`csrf_token`) is issued with `httpOnly: false` so the
 * browser-side JS can read it and include it in the header.
 */
export const csrf: MiddlewareHandler = async (c, next) => {
  if (!STATE_CHANGING_METHODS.has(c.req.method)) {
    await next();
    return;
  }

  const cookieValue = getCookie(c, 'csrf_token');
  const headerValue = c.req.header('X-CSRF-Token');

  if (!cookieValue || !headerValue) {
    throw new ForbiddenError('CSRF token missing');
  }

  // timingSafeEqual requires buffers of equal length; mismatched lengths
  // reveal a length mismatch but not token content — still abort.
  const cookieBuf = Buffer.from(cookieValue, 'utf8');
  const headerBuf = Buffer.from(headerValue, 'utf8');

  if (cookieBuf.length !== headerBuf.length || !timingSafeEqual(cookieBuf, headerBuf)) {
    throw new ForbiddenError('CSRF token mismatch');
  }

  await next();
};
