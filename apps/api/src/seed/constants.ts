/**
 * Canonical seed user literals.
 *
 * Single source of truth for the emails and password env-var name used by both
 * the production seed (apps/api/src/seed/main.ts) and the test fixture factory
 * (apps/api/test/support/fixtures.ts).  Any future drift between those two
 * consumers is caught at typecheck rather than at runtime.
 */

/** Email address seeded for the patient demo account. */
export const SEED_PATIENT_EMAIL = 'patient@medbridge.test' as const;

/** Email address seeded for the doctor demo account. */
export const SEED_DOCTOR_EMAIL = 'doctor@medbridge.test' as const;

/**
 * Name of the environment variable that supplies the plaintext password for
 * seed users.  Referenced in main.ts so tests that override this variable use
 * the same name.
 */
export const SEED_PASSWORD_ENV = 'SEED_PASSWORD' as const;
