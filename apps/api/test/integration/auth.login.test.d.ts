/**
 * Integration tests: auth.login
 *
 * REQUIRES: Docker daemon running on the host (testcontainers).
 *
 * Covers:
 *  - Happy path: 200 + { user: { id, email, role } } body
 *    + HttpOnly session cookie + HttpOnly refresh cookie
 *    + non-HttpOnly csrf_token cookie
 *  - Sad path — unknown email: 401 + { error: { code: 'UNAUTHORIZED' } } + zero Set-Cookie
 *  - Sad path — wrong password:  401 + { error: { code: 'UNAUTHORIZED' } } + zero Set-Cookie
 */
export {};
//# sourceMappingURL=auth.login.test.d.ts.map