/**
 * routes.ts — auth module Hono route definitions
 *
 * Registers four routes:
 *   POST /login    — auth.login  (CSRF exempt per ARCHITECTURE §6.1)
 *   POST /refresh  — auth.refresh (CSRF exempt per ARCHITECTURE §6.1)
 *   POST /logout   — auth.logout  (CSRF required; protected after login)
 *   GET  /me       — auth.me      (requires authn middleware)
 *
 * The router is designed to be mounted at `/v1/auth` by app.ts so that the
 * full paths become `/v1/auth/login`, `/v1/auth/refresh`, etc., which matches
 * the EXEMPT_PATHS set in middleware/csrf.ts exactly.
 *
 * Factory pattern: `createAuthRoutes({ service, authn })` so app.ts can inject
 * the live auth service + authn middleware without coupling this file to
 * singleton imports.
 */
import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";

import { loginRequest, loginResponse, refreshResponse, meResponse, logoutResponse } from "@medbridge/contracts";

import { UnauthorizedError, ValidationError } from "../../shared/errors.js";
import type { AuthService } from "./service.js";
import { buildLoginResponse, buildRefreshResponse, buildMeResponse, buildLogoutResponse } from "./dto.js";

// ---------------------------------------------------------------------------
// Cookie configuration helpers
// ---------------------------------------------------------------------------

/** 15 minutes in seconds — matches the session JWT TTL. */
const SESSION_MAX_AGE = 15 * 60;

/** 7 days in seconds — matches the refresh token TTL. */
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60;

/** Shared options for HttpOnly auth cookies (session + refresh_token). */
const HTTP_ONLY_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
} as const;

/** Options for the non-HttpOnly CSRF cookie (readable by browser JS). */
const CSRF_COOKIE_OPTS = {
  httpOnly: false,
  secure: true,
  sameSite: "Lax",
  path: "/",
} as const;

/** Sets the three auth cookies on the response. */
function setAuthCookies(
  c: Parameters<MiddlewareHandler>[0],
  sessionJwt: string,
  refreshTokenValue: string,
  csrfToken: string,
): void {
  setCookie(c, "session", sessionJwt, {
    ...HTTP_ONLY_COOKIE_OPTS,
    maxAge: SESSION_MAX_AGE,
  });
  setCookie(c, "refresh_token", refreshTokenValue, {
    ...HTTP_ONLY_COOKIE_OPTS,
    maxAge: REFRESH_MAX_AGE,
  });
  setCookie(c, "csrf_token", csrfToken, {
    ...CSRF_COOKIE_OPTS,
    maxAge: REFRESH_MAX_AGE,
  });
}

/** Clears all three auth cookies by setting maxAge to 0. */
function clearAuthCookies(c: Parameters<MiddlewareHandler>[0]): void {
  deleteCookie(c, "session", { path: "/" });
  deleteCookie(c, "refresh_token", { path: "/" });
  deleteCookie(c, "csrf_token", { path: "/" });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type CreateAuthRoutesDeps = {
  /** The live auth service instance to delegate to. */
  readonly service: AuthService;
  /**
   * The `authn` middleware — applied per-route to `GET /me`.
   * Injected so this file does not import the authn singleton directly.
   */
  readonly authn: MiddlewareHandler;
};

/**
 * Creates and returns a Hono router containing all four auth routes.
 *
 * Mount at `/v1/auth` in app.ts:
 *   `app.route("/v1/auth", createAuthRoutes({ service, authn }))`
 */
export function createAuthRoutes({ service, authn }: CreateAuthRoutesDeps): Hono {
  const router = new Hono();

  // -------------------------------------------------------------------------
  // POST /login — auth.login
  // CSRF exempt: this route issues the first session cookie, so no CSRF token
  // can be present yet (ARCHITECTURE §6.1).
  // -------------------------------------------------------------------------
  router.post("/login", async (c) => {
    const body: unknown = await c.req.json();

    const parsed = loginRequest.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Invalid login request", parsed.error.flatten());
    }

    const { email, password } = parsed.data;

    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

    // service.login runs throttle.check internally before argon2 verify
    const tokens = await service.login({ ip, email, password });

    setAuthCookies(c, tokens.sessionJwt, tokens.refreshTokenValue, tokens.csrfToken);

    const responseBody = buildLoginResponse(tokens);
    const validated = loginResponse.parse(responseBody);

    return c.json(validated, 200);
  });

  // -------------------------------------------------------------------------
  // POST /refresh — auth.refresh
  // CSRF exempt: the caller may not yet have a fresh CSRF token (ARCHITECTURE §6.1).
  // Rotates ALL THREE cookies on success; throws 401 on replay.
  // -------------------------------------------------------------------------
  router.post("/refresh", async (c) => {
    const rawToken = getCookie(c, "refresh_token");

    if (rawToken === undefined || rawToken === "") {
      throw new UnauthorizedError("Refresh token cookie missing");
    }

    const requestId = (c.get("requestId") as string | undefined) ?? "unknown";

    const tokens = await service.refresh({ rawToken, requestId });

    setAuthCookies(c, tokens.sessionJwt, tokens.refreshTokenValue, tokens.csrfToken);

    const responseBody = buildRefreshResponse(tokens);
    const validated = refreshResponse.parse(responseBody);

    return c.json(validated, 200);
  });

  // -------------------------------------------------------------------------
  // POST /logout — auth.logout
  // CSRF required (enforced by the global csrf middleware mounted in app.ts).
  // Reads the refresh_token cookie, revokes it, and clears all three cookies.
  // Idempotent: succeeds even if the token is already revoked or absent.
  // -------------------------------------------------------------------------
  router.post("/logout", async (c) => {
    const rawToken = getCookie(c, "refresh_token") ?? "";

    // service.logout is idempotent — silently no-ops on missing/revoked token
    await service.logout({ rawToken });

    clearAuthCookies(c);

    const responseBody = buildLogoutResponse();
    const validated = logoutResponse.parse(responseBody);

    return c.json(validated, 200);
  });

  // -------------------------------------------------------------------------
  // GET /me — auth.me
  // Protected by authn middleware (applied per-route here so that the csrf
  // middleware, which exempts GET requests, does not interfere).
  // -------------------------------------------------------------------------
  router.get("/me", authn, async (c) => {
    const user = c.get("user") as { id: string; email: string; role: string } | undefined;

    if (user === undefined) {
      throw new UnauthorizedError("Authentication required");
    }

    const result = service.me({
      userId: user.id,
      email: user.email,
      role: user.role as "patient" | "doctor",
    });

    const responseBody = buildMeResponse({ id: result.userId, email: result.email, role: result.role });
    const validated = meResponse.parse(responseBody);

    return c.json(validated, 200);
  });

  return router;
}
