/**
 * Shared plaintext password constant for integration tests.
 *
 * All seed users created by fixtures.ts use this password as their plaintext.
 * Re-export it here so tests that drive the real login endpoint can import
 * the credential from one location without duplicating the literal.
 *
 * DO NOT use this value in production code.
 */
/** Plaintext password used by all seeded test users. */
export const SEED_PLAIN_PASSWORD = 'Test1234!@#$';
//# sourceMappingURL=passwords.js.map