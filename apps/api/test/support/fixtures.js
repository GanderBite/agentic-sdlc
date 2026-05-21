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
import { user } from '../../src/db/schema.js';
import { defaultPasswordHasher } from '../../src/modules/auth/passwords.js';
import { SEED_PLAIN_PASSWORD } from './passwords.js';
// ---------------------------------------------------------------------------
// insertSeedUsers
// ---------------------------------------------------------------------------
/**
 * Insert one patient user and one doctor user into the test database.
 *
 * Both users share SEED_PLAIN_PASSWORD as their plaintext password, hashed
 * once per call via defaultPasswordHasher (argon2id). Tests that exercise
 * the login endpoint should use SEED_PLAIN_PASSWORD from passwords.ts.
 *
 * Returns the UUIDs assigned by Postgres.
 */
export async function insertSeedUsers(db) {
    const hash = await defaultPasswordHasher.hash(SEED_PLAIN_PASSWORD);
    const rows = await db
        .insert(user)
        .values([
        {
            email: 'patient@test.local',
            role: 'patient',
            passwordHash: hash,
        },
        {
            email: 'doctor@test.local',
            role: 'doctor',
            passwordHash: hash,
        },
    ])
        .returning({ id: user.id, role: user.role });
    // .returning() propagates IDs — no SELECT after insert (per drizzle skill Rule 11).
    const patientRow = rows.find((r) => r.role === 'patient');
    const doctorRow = rows.find((r) => r.role === 'doctor');
    if (patientRow === undefined || doctorRow === undefined) {
        throw new Error('insertSeedUsers: insert did not return expected rows');
    }
    return { patientId: patientRow.id, doctorId: doctorRow.id };
}
// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------
/**
 * Wipe refresh_token and user tables between tests.
 *
 * Uses RESTART IDENTITY CASCADE so serial sequences reset and FK ordering is
 * handled by Postgres. Call in beforeEach, not beforeAll.
 */
export async function truncate(pool) {
    await pool.query('TRUNCATE TABLE refresh_token, "user" RESTART IDENTITY CASCADE');
}
//# sourceMappingURL=fixtures.js.map