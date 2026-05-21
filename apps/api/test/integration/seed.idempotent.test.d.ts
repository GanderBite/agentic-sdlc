/**
 * seed.idempotent.test.ts
 *
 * Verifies that apps/api/src/seed/main.ts is idempotent:
 *   - First run inserts 2 user rows and exits 0.
 *   - Second run inserts 0 rows and exits 0 (idempotent).
 *   - Final row count in the user table is 2.
 *
 * The seed script calls process.exit() at the end so it cannot be imported
 * programmatically. It is invoked twice as a child process via tsx with
 * DATABASE_URL pointing at the test container.
 *
 * Acceptance bullet 13.
 *
 * REQUIRES: Docker daemon running on the host.
 */
export {};
//# sourceMappingURL=seed.idempotent.test.d.ts.map