/**
 * Integration tests: auth.logout
 *
 * REQUIRES: Docker daemon running on the host (testcontainers).
 *
 * Covers:
 *  - Happy path: 200; session and refresh cookies are cleared (Max-Age=0);
 *    the active refresh_token row is revoked in the database.
 *  - Missing auth: 403 (CSRF) or 401 (authn) when no session/csrf cookies.
 */
export {};
//# sourceMappingURL=auth.logout.test.d.ts.map