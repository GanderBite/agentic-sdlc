/**
 * auth/routes.ts — Hono router for auth RPC endpoints.
 *
 * Route exemptions:
 *   auth.login   — CSRF-exempt, authn-exempt (bootstraps the session)
 *   auth.refresh — CSRF-exempt, authn-exempt (rotates the session)
 *   auth.logout  — requires CSRF + authn
 *   auth.me      — requires authn (GET, so CSRF-exempt by definition)
 *
 * Layering rule (ARCHITECTURE §2.3): routes → service → repo.
 * This file MUST NOT import db, repo, or schema directly.
 */

import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import { loginRequest, loginResponse, refreshResponse } from '@medbridge/contracts';
import { ALLOW_PUBLIC_KEY, authn } from '../../middleware/authn.js';
import { csrf } from '../../middleware/csrf.js';
import { UnauthorizedError, ValidationError } from '../../shared/errors.js';
import {
  csrfCookieOptions,
  refreshCookieOptions,
  sessionCookieOptions,
} from '../../shared/http.js';
import type { AuthService } from './service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthRouteDeps {
  readonly service: AuthService;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Write all three auth cookies after a successful login or refresh. */
function setAuthCookies(
  c: Parameters<typeof setCookie>[0],
  sessionJwt: string,
  refreshTokenRaw: string,
  csrfToken: string,
): void {
  setCookie(c, 'session', sessionJwt, sessionCookieOptions);
  setCookie(c, 'refresh', refreshTokenRaw, refreshCookieOptions);
  setCookie(c, 'csrf_token', csrfToken, csrfCookieOptions);
}

/** Clear all three auth cookies on logout. */
function clearAuthCookies(c: Parameters<typeof deleteCookie>[0]): void {
  deleteCookie(c, 'session', { path: '/' });
  deleteCookie(c, 'refresh', { path: '/' });
  deleteCookie(c, 'csrf_token', { path: '/' });
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createAuthRouter(deps: AuthRouteDeps): Hono {
  const router = new Hono();
  const { service } = deps;

  // -------------------------------------------------------------------------
  // POST /auth.login
  // CSRF-exempt, authn-exempt — bootstraps the session.
  // -------------------------------------------------------------------------
  router.post('auth.login', async (c) => {
    // Mark as public so the global authn middleware (if wired) skips verification.
    c.set(ALLOW_PUBLIC_KEY, true);

    const body = await c.req.json().catch(() => {
      throw new ValidationError('Request body must be valid JSON');
    });

    const parsed = loginRequest.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.flatten());
    }

    const { email, password } = parsed.data;
    const result = await service.login(email, password);

    setAuthCookies(c, result.sessionJwt, result.refreshTokenRaw, result.csrfToken);

    return c.json(loginResponse.parse({ user: result.user }), 200);
  });

  // -------------------------------------------------------------------------
  // POST /auth.refresh
  // CSRF-exempt, authn-exempt — rotates the session using the refresh cookie.
  // -------------------------------------------------------------------------
  router.post('auth.refresh', async (c) => {
    c.set(ALLOW_PUBLIC_KEY, true);

    const refreshRaw = getCookie(c, 'refresh');
    if (!refreshRaw) {
      throw new UnauthorizedError('Refresh cookie missing');
    }

    const requestId = c.get('requestId') as string | undefined;
    const result = await service.refresh(refreshRaw, requestId);

    setAuthCookies(c, result.sessionJwt, result.refreshTokenRaw, result.csrfToken);

    return c.json(refreshResponse.parse({ user: result.user }), 200);
  });

  // -------------------------------------------------------------------------
  // POST /auth.logout
  // Requires CSRF + authn.
  // -------------------------------------------------------------------------
  router.post('auth.logout', csrf, authn, async (c) => {
    const refreshRaw = getCookie(c, 'refresh') ?? '';
    await service.logout(refreshRaw);
    clearAuthCookies(c);
    return c.json({}, 200);
  });

  // -------------------------------------------------------------------------
  // GET /auth.me
  // Requires authn (GET is inherently CSRF-exempt per the double-submit spec).
  // -------------------------------------------------------------------------
  router.get('auth.me', authn, async (c) => {
    const user = c.get('user') as { userId: string } | undefined;
    if (!user) {
      throw new UnauthorizedError('Not authenticated');
    }
    const result = await service.me(user.userId);
    return c.json({ user: result.user }, 200);
  });

  return router;
}
