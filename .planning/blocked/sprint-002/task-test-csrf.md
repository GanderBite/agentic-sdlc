# task-test-csrf — blocked

**Verdict from tester:** `partial`. File written, all 3 verifier regex gates pass. Blocked on production code.

## Blocker

Same `csrf.ts` EXEMPT_PATHS / mount-prefix mismatch as the other wave-10 partials. `apps/api/src/middleware/csrf.ts:17` exempts `/v1/auth/login` and `/v1/auth/refresh`, but `apps/api/src/app.ts:63` mounts at `/api`. `POST /api/login` returns `403 FORBIDDEN` — the csrf test's `loginAs(...)` precondition fails before the test can exercise its three cases.

## Suggested fix

Change `EXEMPT_PATHS` to `new Set(["/api/login", "/api/refresh"])` in `apps/api/src/middleware/csrf.ts`.

## File status

`apps/api/test/integration/csrf.test.ts` is complete with the three double-submit cases (missing header → 403, mismatched header → 403, matching header → 200). Will pass at runtime once the EXEMPT_PATHS mismatch is fixed.
