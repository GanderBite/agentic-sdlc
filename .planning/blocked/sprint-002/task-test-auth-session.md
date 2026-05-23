# task-test-auth-session — blocked

**Verdict from tester:** `partial`. File written, all 6 verifier regex gates pass. Blocked on TWO production code bugs.

## Blocker 1 — CSRF EXEMPT_PATHS / mount prefix mismatch

`apps/api/src/middleware/csrf.ts:17` exempts `/v1/auth/login` and `/v1/auth/refresh`, but `apps/api/src/app.ts:63` mounts at `/api`. `POST /api/login` returns `403 FORBIDDEN` instead of reaching the auth handler. The session test's `loginAs(...)` precondition fails.

**Fix:** change `EXEMPT_PATHS` to `["/api/login", "/api/refresh"]`.

## Blocker 2 — jose clockTolerance defaulting to 0

`apps/api/src/middleware/authn.ts` calls `jwtVerify(token, secretKey, { algorithms: ['HS256'] })` without a `clockTolerance` option. Jose defaults to `0s` tolerance, so a token with `exp = now - 4s` is rejected — contradicting the architecture's "5-second tolerance" guarantee (B12). The session test's case "exp 4s in the past must still pass" will fail.

**Fix:** add `clockTolerance: 5` to the `jwtVerify` options:

```ts
const { payload } = await jwtVerify(token, secretKey, {
  algorithms: ['HS256'],
  clockTolerance: 5,
});
```

## File status

`apps/api/test/integration/auth.session.test.ts` is complete with cases for `/me` happy/sad paths, logout cookie-clear + DB revocation, JWT clock-skew (4s pass, 6s reject), and HS256 algorithm pinning (HS384 → 401). Will pass at runtime once both production bugs are fixed.
