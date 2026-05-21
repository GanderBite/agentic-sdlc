#!/usr/bin/env node
/**
 * One-shot seed script.
 *
 * Usage (after drizzle-kit migrate completes):
 *   node dist/seed/main.js
 *
 * Env:
 *   DATABASE_URL  — required (same as api)
 *   SEED_PASSWORD — plaintext password to hash; defaults to 'CorrectHorseBatteryStaple1!'
 *
 * Idempotent: uses ON CONFLICT (email) DO NOTHING so re-runs insert zero rows.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { z } from 'zod';

import { defaultPasswordHasher } from '../modules/auth/passwords.js';
import { user } from '../modules/auth/schema.js';
import { SEED_DOCTOR_EMAIL, SEED_PATIENT_EMAIL } from './constants.js';

// ---------------------------------------------------------------------------
// Env — minimal schema for the seed; avoids importing shared/env.ts which
// would require JWT_SECRET and other vars not needed here.
// ---------------------------------------------------------------------------
const seedEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  SEED_PASSWORD: z.string().default('CorrectHorseBatteryStaple1!'),
});

const envResult = seedEnvSchema.safeParse(process.env);
if (!envResult.success) {
  const issues = envResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  console.error(`[seed] env validation failed: ${issues}`);
  process.exit(1);
}

const { DATABASE_URL, SEED_PASSWORD } = envResult.data;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
});

const db = drizzle(pool);

async function run(): Promise<void> {
  const passwordHash = await defaultPasswordHasher.hash(SEED_PASSWORD);

  const seeds = [
    { email: SEED_PATIENT_EMAIL, role: 'patient' as const, passwordHash },
    { email: SEED_DOCTOR_EMAIL, role: 'doctor' as const, passwordHash },
  ];

  const result = await db
    .insert(user)
    .values(seeds)
    .onConflictDoNothing({ target: user.email })
    .returning({ id: user.id, email: user.email });

  console.info(
    `[seed] inserted ${result.length} row(s): ${result.map((r) => r.email).join(', ') || '(none — already existed)'}`,
  );
}

run()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error('[seed] fatal error', err);
    await pool.end();
    process.exit(1);
  });
