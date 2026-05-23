# task-test-auth-login — blocked

**Verdict from tester:** `partial`. File written, all 8 verifier regex gates pass (`rg --quiet`). Blocked on production code.

## Blocker

`apps/api/src/middleware/csrf.ts:17` defines:

```ts
const EXEMPT_PATHS = new Set(["/v1/auth/login", "/v1/auth/refresh"]);
```

But `apps/api/src/app.ts:63` mounts the auth router at `/api`, so the actual routes are `/api/login` and `/api/refresh`. `POST /api/login` is therefore NOT csrf-exempt — the request lands with no `csrf_token` cookie yet and the middleware returns `403 FORBIDDEN` before reaching the auth service. Every login test in this file expects `200` or `401` from the auth path and will fail with `403` at runtime.

## Suggested fix

Change one of:
- `EXEMPT_PATHS` to `new Set(["/api/login", "/api/refresh"])`, OR
- `app.ts` mount prefix from `/api` to `/v1/auth`.

The first is lower-risk because it keeps existing route paths stable.

## File status

`apps/api/test/integration/auth.login.test.ts` is complete with all 7 case clusters (valid creds, wrong password, unknown email, constant-time verify path, throttle 10→11 cutoff, different-email-same-IP not throttled, case-insensitive email keying). Will pass at runtime once the production bug is fixed.
