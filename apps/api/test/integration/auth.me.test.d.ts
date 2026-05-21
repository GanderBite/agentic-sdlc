/**
 * Integration tests: auth.me
 *
 * REQUIRES: Docker daemon running on the host (testcontainers).
 *
 * Covers:
 *  - Valid session cookie returns the seeded user's data (200)
 *  - Missing session cookie returns 401 UNAUTHORIZED
 *  - Invalid/tampered session JWT returns 401 UNAUTHORIZED
 */
export {};
//# sourceMappingURL=auth.me.test.d.ts.map