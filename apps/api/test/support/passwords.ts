/**
 * passwords.ts — spy-able argon2 surface for integration tests
 *
 * Production code (`apps/api/src/shared/password.ts`) is NOT modified.
 * This module wraps argon2 directly so tests can vi.spyOn these exports
 * without touching the production module.
 *
 * Usage in a test:
 *
 *   import * as passwords from "../support/passwords.js";
 *   vi.spyOn(passwords, "verify").mockResolvedValueOnce(true);
 *
 * This file intentionally has NO module-level side-effects. Mocking is
 * always opt-in per test case.
 */
import argon2 from "argon2";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify a plaintext password against an argon2 hash.
 *
 * The indirection allows `vi.spyOn(passwords, "verify")` in tests that need
 * to short-circuit the full argon2 computation (e.g. timing-insensitive
 * acceptance tests).
 */
export async function verify(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}

/**
 * Hash a plaintext password using argon2id.
 *
 * Re-exported here so test helpers that create seed data can import from one
 * place and optionally spy on hashing as well.
 */
export async function hash(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}
