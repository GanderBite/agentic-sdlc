import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../src/db/client.ts';
import { defaultPasswordHasher } from '../../src/modules/auth/passwords.ts';
import { user } from '../../src/modules/auth/schema.ts';
import { SEED_PLAINTEXT } from './passwords.ts';

// ---------------------------------------------------------------------------
// Seed users
// ---------------------------------------------------------------------------

export interface SeedUserIds {
  patientId: string;
  doctorId: string;
}

/**
 * Insert one patient and one doctor into the database using the production
 * password hasher.  Uses onConflictDoNothing so the function is idempotent
 * across repeated calls within the same test container.
 *
 * IDs are re-fetched by email after the insert, so they are correct regardless
 * of whether the row was newly inserted or was already present.
 */
export async function insertSeedUsers(db: Db): Promise<SeedUserIds> {
  const passwordHash = await defaultPasswordHasher.hash(SEED_PLAINTEXT);

  await db
    .insert(user)
    .values([
      {
        email: 'patient@seed.test',
        role: 'patient',
        passwordHash,
      },
      {
        email: 'doctor@seed.test',
        role: 'doctor',
        passwordHash,
      },
    ])
    .onConflictDoNothing({ target: user.email });

  // Re-fetch by email to obtain the IDs regardless of whether the rows were
  // just inserted or already existed.
  const [patientRow] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, 'patient@seed.test'))
    .limit(1);

  const [doctorRow] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, 'doctor@seed.test'))
    .limit(1);

  if (!patientRow) throw new Error('insertSeedUsers: patient row not found after insert');
  if (!doctorRow) throw new Error('insertSeedUsers: doctor row not found after insert');

  return { patientId: patientRow.id, doctorId: doctorRow.id };
}

// ---------------------------------------------------------------------------
// Truncate helper
// ---------------------------------------------------------------------------

/**
 * Wipe all auth-related rows between tests.
 * FK order: refresh_token references user, so refresh_token must be truncated first.
 * RESTART IDENTITY resets sequences; CASCADE handles any future dependent tables.
 */
export async function truncate(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE "refresh_token", "user" RESTART IDENTITY CASCADE`);
}
