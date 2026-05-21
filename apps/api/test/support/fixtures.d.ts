/**
 * Fixture factories for integration tests.
 *
 * insertSeedUsers(db) → { patientId, doctorId }
 *   Hashes are produced via defaultPasswordHasher so tests can call the real
 *   login endpoint with SEED_PLAIN_PASSWORD and have argon2 verify succeed.
 *
 * truncate(pool) → Promise<void>
 *   Wipes refresh_token and "user" between tests in FK-safe order.
 *
 * Usage:
 *
 *   import { insertSeedUsers, truncate } from '../support/fixtures.js';
 *   import { SEED_PLAIN_PASSWORD } from '../support/passwords.js';
 *
 *   let patientId: string;
 *   let doctorId: string;
 *
 *   beforeEach(async () => {
 *     await truncate(pool);
 *     ({ patientId, doctorId } = await insertSeedUsers(db));
 *   });
 */
import type { Pool } from 'pg';
import type { Db } from './db.js';
export interface SeedUsers {
    patientId: string;
    doctorId: string;
}
/**
 * Insert one patient user and one doctor user into the test database.
 *
 * Both users share SEED_PLAIN_PASSWORD as their plaintext password, hashed
 * once per call via defaultPasswordHasher (argon2id). Tests that exercise
 * the login endpoint should use SEED_PLAIN_PASSWORD from passwords.ts.
 *
 * Returns the UUIDs assigned by Postgres.
 */
export declare function insertSeedUsers(db: Db): Promise<SeedUsers>;
/**
 * Wipe refresh_token and user tables between tests.
 *
 * Uses RESTART IDENTITY CASCADE so serial sequences reset and FK ordering is
 * handled by Postgres. Call in beforeEach, not beforeAll.
 */
export declare function truncate(pool: Pool): Promise<void>;
//# sourceMappingURL=fixtures.d.ts.map