/**
 * Auth Hono router.
 *
 * Route summary:
 *   POST /auth.login    — CSRF-exempt, authn-exempt; bootstraps a session.
 *   POST /auth.logout   — CSRF-required, authn-required; revokes refresh token.
 *   POST /auth.refresh  — CSRF-exempt, authn-exempt; rotates tokens via cookie.
 *   GET  /auth.me       — authn-required; returns the current user profile.
 *
 * Cookie management delegates to the three preset option objects from
 * `../../shared/http.ts` so security flags stay consistent across the codebase.
 *
 * All request/response contracts come from `@medbridge/contracts` — no inline
 * schema shapes appear here (layering rule §2.3).
 */

import type { Context } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import { loginRequest, loginResponse, meResponse, refreshResponse } from '@medbridge/contracts';

import { authn } from '../../middleware/authn.js';
import { csrf } from '../../middleware/csrf.js';
import { ValidationError } from '../../shared/errors.js';
import {
  csrfCookieOptions,
  refreshCookieOptions,
  sessionCookieOptions,
} from '../../shared/http.js';
import type { AuthService } from './service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Variables the auth router expects to find on the Hono context. */
type AuthRouterVars = {
  Variables: {
    requestId: string;
    userId: string;
    user: { userId: string; role: string };
    log: { warn(obj: Record<string, unknown>, msg?: string): void };
    allowPublic: boolean;
  };
};

/** Shape injected by wireAuth */
export interface AuthRouteDeps {
  readonly service: AuthService;
}

// ---------------------------------------------------------------------------
// Cookie helpers — centralise set/clear so every route is consistent
// ---------------------------------------------------------------------------

function setAuthCookies(
  c: Context,
  sessionJwt: string,
  refreshTokenRaw: string,
  csrfToken: string,
): void {
  setCookie(c, 'session', sessionJwt, sessionCookieOptions);
  setCookie(c, 'refresh', refreshTokenRaw, refreshCookieOptions);
  setCookie(c, 'csrf_token', csrfToken, csrfCookieOptions);
}

function clearAuthCookies(c: Context): void {
  deleteCookie(c, 'session', { path: '/' });
  deleteCookie(c, 'refresh', { path: '/' });
  deleteCookie(c, 'csrf_token', { path: '/' });
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Builds the auth Hono sub-router wired to the given `AuthService`.
 * Call via `wireAuth(app, { service })` from the module index.
 */
export function createAuthRouter(deps: AuthRouteDeps): Hono<AuthRouterVars> {
  const { service } = deps;
  const router = new Hono<AuthRouterVars>();

  // -------------------------------------------------------------------------
  // POST /auth.login — CSRF-exempt, authn-exempt
  // -------------------------------------------------------------------------

  router.post('/auth.login', async (c) => {
    const body = await c.req.json();
    const parsed = loginRequest.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.flatten());
    }

    const { email, password } = parsed.data;
    const result = await service.login(email, password);

    setAuthCookies(c, result.sessionJwt, result.refreshTokenRaw, result.csrfToken);

    const responseBody = loginResponse.parse({ user: result.user });
    return c.json(responseBody, 200);
  });

  // -------------------------------------------------------------------------
  // POST /auth.logout — CSRF-required, authn-required
  // -------------------------------------------------------------------------

  router.post('/auth.logout', csrf, authn, async (c) => {
    const refreshRaw = getCookie(c, 'refresh') ?? '';

    if (refreshRaw) {
      await service.logout(refreshRaw);
    }

    clearAuthCookies(c);
    return c.json({}, 200);
  });

  // -------------------------------------------------------------------------
  // POST /auth.refresh — CSRF-exempt, authn-exempt
  // -------------------------------------------------------------------------

  router.post('/auth.refresh', async (c) => {
    const refreshRaw = getCookie(c, 'refresh');
    const requestId = c.get('requestId') ?? 'unknown';

    if (!refreshRaw) {
      throw new ValidationError('Refresh token cookie missing');
    }

    const result = await service.refresh(refreshRaw, requestId);

    setAuthCookies(c, result.sessionJwt, result.refreshTokenRaw, result.csrfToken);

    const responseBody = refreshResponse.parse({ user: result.user });
    return c.json(responseBody, 200);
  });

  // -------------------------------------------------------------------------
  // GET /auth.me — authn-required (no CSRF — GET is exempt by csrf middleware)
  // -------------------------------------------------------------------------

  router.get('/auth.me', authn, async (c) => {
    const user = c.get('user');
    const result = await service.me(user.userId);

    const responseBody = meResponse.parse({ user: result });
    return c.json(responseBody, 200);
  });

  return router;
}
