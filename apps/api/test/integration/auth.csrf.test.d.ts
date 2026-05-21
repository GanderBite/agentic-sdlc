/**
 * Integration tests: CSRF protection on auth.logout
 *
 * REQUIRES: Docker daemon running on the host (testcontainers).
 *
 * Covers:
 *  - POST /api/auth.logout without X-CSRF-Token header returns 403 FORBIDDEN
 *  - POST /api/auth.logout with mismatched X-CSRF-Token header returns 403 FORBIDDEN
 *  - POST /api/auth.logout with matching X-CSRF-Token header succeeds (200)
 *
 * auth.logout declares per-route `csrf, authn` middleware in routes.ts.
 */
export {};
//# sourceMappingURL=auth.csrf.test.d.ts.map