import { db, pool } from '../db/client.ts';
import { defaultPasswordHasher } from '../modules/auth/passwords.ts';
import { user } from '../modules/auth/schema.ts';
import { logger } from '../shared/logger.ts';

// ---------------------------------------------------------------------------
// Seed entry-point
// ---------------------------------------------------------------------------
// Run after drizzle-kit migrations complete:
//   node dist/seed/main.js
//
// Idempotent: uses ON CONFLICT DO NOTHING so re-runs insert zero rows.
// SEED_PASSWORD is intentionally outside the main env schema — it is only
// relevant to the one-shot seed container, not the long-running API.
// ---------------------------------------------------------------------------

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'CorrectHorseBatteryStaple1!';

const PATIENT_EMAIL = 'patient@medbridge.test';
const DOCTOR_EMAIL = 'doctor@medbridge.test';

async function main(): Promise<void> {
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

  const patientInserted = patientResult.length > 0;
  const doctorInserted = doctorResult.length > 0;

  logger.info({ patientInserted, doctorInserted }, 'seed complete');
}

main()
  .catch((err: unknown) => {
    logger.error({ err }, 'seed failed');
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
