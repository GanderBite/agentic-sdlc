import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";

import { db, pool } from "../shared/db.js";
import { hash } from "../shared/password.js";
import { user } from "../modules/accounts/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type Fixture = {
  email: string;
  password: string;
  role: "patient" | "doctor";
};

function loadFixtures(): readonly Fixture[] {
  const fixturePath = resolve(__dirname, "fixtures/users.json");
  const raw = readFileSync(fixturePath, "utf8");
  const parsed: unknown = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("fixtures/users.json must be a JSON array");
  }

  return parsed.map((item: unknown, index: number): Fixture => {
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
      throw new Error(`Fixture at index ${index} is missing required string fields: email, password, role`);
    }

    const role = (item as Record<string, unknown>)["role"] as string;
    if (role !== "patient" && role !== "doctor") {
      throw new Error(`Fixture at index ${index} has invalid role "${role}"; must be "patient" or "doctor"`);
    }

    return {
      email: (item as Record<string, unknown>)["email"] as string,
      password: (item as Record<string, unknown>)["password"] as string,
      role: role as "patient" | "doctor",
    };
  });
}

async function seed(): Promise<void> {
  const fixtures = loadFixtures();

  await db.transaction(async (tx) => {
    for (const fixture of fixtures) {
      const existing = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, fixture.email))
        .limit(1);

      const firstExisting = existing[0];
      if (firstExisting !== undefined) {
        console.log(`[seed] skipping ${fixture.email} — already exists (id: ${firstExisting.id})`);
        continue;
      }

      const passwordHash = await hash(fixture.password);

      await tx.insert(user).values({
        email: fixture.email,
        role: fixture.role,
        passwordHash,
      });

      console.log(`[seed] inserted ${fixture.email} (role: ${fixture.role})`);
    }
  });

  console.log("[seed] done");
}

seed()
  .then(() => {
    void pool.end().then(() => process.exit(0));
  })
  .catch((err: unknown) => {
    console.error("[seed] fatal error:", err);
    void pool.end().then(() => process.exit(1));
  });
