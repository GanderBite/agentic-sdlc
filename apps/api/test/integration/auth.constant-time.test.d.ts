/**
 * auth.constant-time.test.ts
 *
 * Adversarial smoke: verifies that hasher.verify is called EXACTLY ONCE per
 * login attempt regardless of whether the email exists in the database.
 *
 * Acceptance bullets 7 and 14:
 *   - unknown email → verify called once (against the DUMMY_HASH constant)
 *   - known email + wrong password → verify called once (against stored hash)
 * Both branches must return 401.
 *
 * Strategy: build the app using production building blocks (createAuthService +
 * wireAuth) with a spied PasswordHasher. The repo is wired directly to the test
 * Drizzle instance so no production DB singleton is involved.
 *
 * REQUIRES: Docker daemon running on the host.
 */
export {};
//# sourceMappingURL=auth.constant-time.test.d.ts.map