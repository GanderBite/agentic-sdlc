/**
 * fixtures.ts — truncate-and-seed helper for integration tests
 *
 * Usage (in integration tests, from `beforeEach`):
 *
 *   import { drizzle } from "drizzle-orm/node-postgres";
 *   import { Pool } from "pg";
 *   import { seedFixtures } from "../support/fixtures.js";
 *
 *   const pool = new Pool({ connectionString: url });
 *   const db = drizzle(pool);
 *   const { patient, doctor } = await seedFixtures(db);
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sql } from "drizzle-orm";

import type { Db } from "../../src/shared/db.js";

import { hash } from "../../src/shared/password.js";
import { user as userTable } from "../../src/modules/accounts/schema.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = resolve(__dirname, "../../src/seed/fixtures/users.json");

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type RawFixture = {
  readonly email: string;
  readonly password: string;
  readonly role: "patient" | "doctor";
};

/** A seeded user row returned by `seedFixtures`. */
export type SeededUser = typeof userTable.$inferSelect;

export type SeededFixtures = {
  readonly patient: SeededUser;
  readonly doctor: SeededUser;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse and validate the raw users.json fixture file. */
function loadRawFixtures(): readonly RawFixture[] {
  const raw = readFileSync(FIXTURES_PATH, "utf8");
  const parsed: unknown = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("fixtures/users.json must be a JSON array");
  }

  return parsed.map((item: unknown, index: number): RawFixture => {
    if (
      typeof item !== "object" ||
      item === null ||
      !("email" in item) ||
      !("password" in item) ||
      !("role" in item) ||
      typeof (item as Record<string, unknown>)["email"] !== "string" ||
      typeof (item as Record<string, unknown>)["password"] !== "string" ||
      typeof (item as Record<string, unknown>)["role"] !== "string"
    ) {
      throw new Error(
        `Fixture at index ${index} is missing required string fields: email, password, role`,
      );
    }

    const role = (item as Record<string, unknown>)["role"] as string;
    if (role !== "patient" && role !== "doctor") {
      throw new Error(
        `Fixture at index ${index} has invalid role "${role}"; must be "patient" or "doctor"`,
      );
    }

    return {
      email: (item as Record<string, unknown>)["email"] as string,
      password: (item as Record<string, unknown>)["password"] as string,
      role: role as "patient" | "doctor",
    };
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Truncate all relevant tables and re-seed the canonical fixture users.
 *
 * Call with a drizzle NodePgDatabase instance built from the test container's
 * connection pool.
 *
 * Returns the inserted `patient` and `doctor` user rows so tests can reference
 * their IDs and attributes.
 *
 * Tables truncated: refresh_token, "user" (FK-safe cascade order).
 */
export async function seedFixtures(db: Db): Promise<SeededFixtures> {
  // Truncate in FK-safe cascade order (refresh_token → user).
  await db.execute(
    sql`TRUNCATE TABLE refresh_token, "user" RESTART IDENTITY CASCADE`,
  );

  const fixtures = loadRawFixtures();
  const inserted: SeededUser[] = [];

  for (const fixture of fixtures) {
    const passwordHash = await hash(fixture.password);
    const rows = await db
      .insert(userTable)
      .values({ email: fixture.email, role: fixture.role, passwordHash })
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error(`Failed to insert fixture user ${fixture.email}`);
    }
    inserted.push(row);
  }

  // Locate the patient and doctor rows by role.
  const patient = inserted.find((r) => r.role === "patient");
  const doctor = inserted.find((r) => r.role === "doctor");

  if (patient === undefined || doctor === undefined) {
    throw new Error(
      "seedFixtures: users.json must contain at least one patient and one doctor",
    );
  }

  return { patient, doctor };
}
