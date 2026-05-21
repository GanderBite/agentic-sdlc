/**
 * auth.boot-jwt-secret.test.ts
 *
 * Adversarial smoke: verifies that the application refuses to start when
 * JWT_SECRET is shorter than 32 bytes, and surfaces a useful error message
 * that mentions JWT_SECRET and the minimum length (32).
 *
 * No Postgres container is needed — the env validation throws synchronously
 * before any DB connection is attempted.
 *
 * Acceptance bullet 10.
 */
export {};
//# sourceMappingURL=auth.boot-jwt-secret.test.d.ts.map