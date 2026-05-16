# auth

JWT access tokens, server-side refresh tokens, and CSRF double-submit wiring for Hono.

## Token model

- **Access**: `jose`-signed JWT, 15-minute TTL, `HS256` with `JWT_SECRET` (32B+ from env). Carried in cookie `at` (HttpOnly, Secure, SameSite=Lax).
- **Refresh**: opaque 256-bit random string, stored hashed in `refresh_tokens` table with `(userId, jti, expiresAt, rotatedFromJti?)`. 7-day TTL. Carried in cookie `rt` (HttpOnly, Secure, SameSite=Lax, `path: '/v1/auth/refresh'`).
- **CSRF**: 128-bit random string, cookie `csrf` (NOT HttpOnly, Secure, SameSite=Lax). Re-issued on login and refresh.

## authRequired middleware

```ts
// src/middleware/auth.ts
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { jwtVerify } from 'jose';
import { AppError } from '../errors';
import { JWT_KEY } from '../config';

export const authRequired: MiddlewareHandler = async (c, next) => {
  const token = getCookie(c, 'at');
  if (!token) throw new AppError('UNAUTHORIZED', 'missing access token', 401);

  try {
    const { payload } = await jwtVerify(token, JWT_KEY, {
      issuer: 'medbridge',
      audience: 'medbridge-api',
    });
    c.set('user', {
      id: String(payload.sub),
      roles: Array.isArray(payload.roles) ? payload.roles : [],
    });
  } catch {
    throw new AppError('UNAUTHORIZED', 'invalid access token', 401);
  }

  await next();
};
```

## CSRF middleware

```ts
// src/middleware/csrf.ts
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { AppError } from '../errors';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export const csrf: MiddlewareHandler = async (c, next) => {
  if (SAFE.has(c.req.method)) return next();
  const cookieToken = getCookie(c, 'csrf');
  const headerToken = c.req.header('x-csrf-token');
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    throw new AppError('CSRF_INVALID', 'csrf mismatch', 403);
  }
  await next();
};
```

Constant-time compare not strictly required because the cookie is the source the attacker cannot read cross-origin; the header echo proves same-origin. Still, prefer `crypto.timingSafeEqual` if upgrading later.

## Refresh flow

`POST /v1/auth/refresh`:

1. Read `rt` cookie. If absent, `UNAUTHORIZED`.
2. Hash and look up in `refresh_tokens`. If missing or `expiresAt < now()` or `revokedAt` set → `UNAUTHORIZED`.
3. In one DB transaction: mark old row revoked, insert new refresh row with `rotatedFromJti = oldJti`.
4. Issue a new access JWT (15 min) and rotated refresh cookie.
5. Re-issue `csrf` cookie.
6. Return `{ ok: true }` — never embed tokens in the JSON body.

Detection: if a revoked refresh is presented again, treat as compromise — revoke the entire user's chain (all `refresh_tokens` for `userId`) and force re-login.

## Cookie helper

```ts
import { setCookie } from 'hono/cookie';

const baseCookie = { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' } as const;

setCookie(c, 'at',   accessJwt,    { ...baseCookie, maxAge: 15 * 60 });
setCookie(c, 'rt',   refreshToken, { ...baseCookie, path: '/v1/auth/refresh', maxAge: 7 * 24 * 60 * 60 });
setCookie(c, 'csrf', csrfToken,    { ...baseCookie, httpOnly: false, maxAge: 7 * 24 * 60 * 60 });
```

## Logout

`POST /v1/auth/logout`:
1. Revoke the current `rt` row.
2. Clear `at`, `rt`, `csrf` cookies (`deleteCookie(c, name, { path: ... })`).
3. Return 204.

## Forbidden vs Unauthorized

- Missing/invalid `at` → `UNAUTHORIZED` (401). Client should attempt refresh.
- Valid `at` but role/permission fails → `FORBIDDEN` (403). Client must not retry.
