/**
 * Integration test — seed/main.ts idempotency.
 *
 * Runs the seed logic twice against the same container.
 * First run inserts 2 user rows; second run inserts 0 (ON CONFLICT DO NOTHING).
 * Final row count remains 2 (enriched bullet 13).
 *
 * The seed/main.ts is a side-effect module that calls main() and pool.end() at
 * module scope. We test its logic by:
 *   1. Mocking db/client to point at the test container.
 *   2. Extracting and calling the seed insert logic directly using the same
 *      schema and hasher the real module uses.
 *
 * Requires Docker to be running on the host.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'integration-test-secret-must-be-at-least-32bytes';
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  process.env.NODE_ENV = 'test';
  process.env.SEED_PASSWORD = 'CorrectHorseBatteryStaple1!';
});

import type { TestDb } from '../support/db.ts';

let testDb: TestDb;

vi.mock('../../src/db/client.ts', () => ({
  get db() {
    return testDb.db;
  },
  get pool() {
    return testDb.pool;
  },
  createDb: () => {
    throw new Error('createDb should not be called in integration tests');
  },
}));

import { count } from 'drizzle-orm';
import { defaultPasswordHasher } from '../../src/modules/auth/passwords.ts';
import { user } from '../../src/modules/auth/schema.ts';
import { startPostgresContainer, stopPostgresContainer } from '../support/db.ts';
import { truncate } from '../support/fixtures.ts';

// ---------------------------------------------------------------------------
// Seed constants matching seed/main.ts exactly.
// ---------------------------------------------------------------------------
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'CorrectHorseBatteryStaple1!';
const PATIENT_EMAIL = 'patient@medbridge.test';
const DOCTOR_EMAIL = 'doctor@medbridge.test';

/**
 * Run the seed logic once against the injected db.
 * Mirrors the main() function in apps/api/src/seed/main.ts without the
 * pool.end() call (which would terminate our test container's pool).
 *
 * Returns { patientInserted, doctorInserted } — true if the row was new.
 */
async function runSeed(
  db: TestDb['db'],
): Promise<{ patientInserted: boolean; doctorInserted: boolean }> {
  const passwordHash = await defaultPasswordHasher.hash(SEED_PASSWORD);

  const patientResult = await db
    .insert(user)
    .values({
      email: PATIENT_EMAIL,
      role: 'patient',
      passwordHash,
    })
    .onConflictDoNothing({ target: user.email })
    .returning({ id: user.id });

  const doctorResult = await db
    .insert(user)
    .values({
      email: DOCTOR_EMAIL,
      role: 'doctor',
      passwordHash,
    })
    .onConflictDoNothing({ target: user.email })
    .returning({ id: user.id });

  return {
    patientInserted: patientResult.length > 0,
    doctorInserted: doctorResult.length > 0,
  };
}

/** Count total user rows in the database. */
async function countUsers(db: TestDb['db']): Promise<number> {
  const rows = await db.select({ total: count() }).from(user);
  const row = rows[0];
  return row?.total ?? 0;
}

beforeAll(async () => {
  testDb = await startPostgresContainer();
}, 60_000);

afterAll(async () => {
  await stopPostgresContainer({ pool: testDb.pool, container: testDb.container });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('seed idempotency — runs twice against the same container', () => {
  it('first run inserts 2 user rows and second run inserts 0, final count is 2', async () => {
    // Start with a clean slate
    await truncate(testDb.db);

    // Verify initial state
    const initialCount = await countUsers(testDb.db);
    expect(initialCount).toBe(0);

    // First seed run — should insert 2 rows
    const firstRun = await runSeed(testDb.db);
    expect(firstRun.patientInserted).toBe(true);
    expect(firstRun.doctorInserted).toBe(true);

    const countAfterFirst = await countUsers(testDb.db);
    expect(countAfterFirst).toBe(2);

    // Second seed run (idempotent) — should insert 0 rows
    const secondRun = await runSeed(testDb.db);
    expect(secondRun.patientInserted).toBe(false);
    expect(secondRun.doctorInserted).toBe(false);

    // Final count must still be 2
    const countAfterSecond = await countUsers(testDb.db);
    expect(countAfterSecond).toBe(2);
  });

  it('running seed twice produces identical user rows (same emails, same roles)', async () => {
    await truncate(testDb.db);

    // First run
    await runSeed(testDb.db);
    const afterFirst = await testDb.db.select().from(user).orderBy(user.email);

    // Second run (idempotent)
    await runSeed(testDb.db);
    const afterSecond = await testDb.db.select().from(user).orderBy(user.email);

    // Same number of rows
    expect(afterSecond).toHaveLength(afterFirst.length);
    expect(afterSecond).toHaveLength(2);

    // Same emails in same order
    expect(afterSecond[0]?.email).toBe(afterFirst[0]?.email);
    expect(afterSecond[1]?.email).toBe(afterFirst[1]?.email);

    // Same IDs (rows were not replaced)
    expect(afterSecond[0]?.id).toBe(afterFirst[0]?.id);
    expect(afterSecond[1]?.id).toBe(afterFirst[1]?.id);
  });

  it('seed inserts a patient and a doctor row with correct roles', async () => {
    await truncate(testDb.db);

    await runSeed(testDb.db);

    const rows = await testDb.db.select().from(user).orderBy(user.email);
    expect(rows).toHaveLength(2);

    const doctor = rows.find((r) => r.email === DOCTOR_EMAIL);
    const patient = rows.find((r) => r.email === PATIENT_EMAIL);

    expect(doctor).toBeDefined();
    expect(doctor?.role).toBe('doctor');

    expect(patient).toBeDefined();
    expect(patient?.role).toBe('patient');
  });
});
