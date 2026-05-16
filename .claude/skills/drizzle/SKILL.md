<!-- version: 1.0.0 -->

# drizzle

## Purpose

Encodes Drizzle ORM `^0.38.x` + Drizzle Kit `^0.30.x` usage for MedBridge: schema definition with the `pg` driver, relations, transactions, prepared statements, soft-delete, migration workflow, and pool config. The long-running `api` service NEVER auto-migrates.

## Consumers

- `builder` (writes `apps/api/src/modules/*/schema.ts`, `*/repo.ts`, `db/migrations/*.sql`)
- `reviewer` (verifies schema and migration conformance)
- `tester` (writes integration tests that apply migrations against a testcontainers Postgres)

## Rules

### Driver, pool, client

1. Import the driver from `drizzle-orm/node-postgres`. Never import from `drizzle-orm/postgres-js`, `drizzle-orm/neon-serverless`, or `drizzle-orm/pglite`.
2. Construct exactly one `pg.Pool` and one `drizzle(pool, { schema })` instance per `apps/api` process. Export the resulting `db` from `apps/api/src/shared/db.ts` and import it everywhere else.
3. Pass the full schema barrel as the `schema` option to `drizzle(...)`. Without it, the relational query API (`db.query.<table>.findMany`) returns `unknown`.
4. Configure the pool with explicit `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`. Never rely on `pg` defaults (`max: 10`, infinite idle).
5. Call `pool.end()` exactly once on `SIGTERM` / `SIGINT`. Never call `pool.end()` inside a request handler.

### Schema files

6. Place table definitions in `apps/api/src/modules/<name>/schema.ts`. Re-export every module schema from `apps/api/src/db/schema.ts` — that barrel is what Drizzle Kit reads.
7. Define tables with `pgTable("<snake_case_table>", { ... })`. Table names are `snake_case`; the JS column keys are `camelCase` and Drizzle column names are explicit `snake_case` strings.
8. Use `uuid("id").primaryKey().default(sql\`gen_random_uuid()\`)` for primary keys. `gen_random_uuid()` requires `pgcrypto`, which is enabled by `apps/api/src/db/migrations/0000_*.sql` — never assume it auto-enables.
9. Use `timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()` for audit columns. Always `withTimezone: true`. Always `mode: "date"` (returns `Date`, not string).
10. Mark every column either `.notNull()` or explicitly nullable (TS-inferred). Never leave nullability implicit.
11. Declare foreign keys with `.references(() => otherTable.id, { onDelete: "..." })`. The function form is required to break circular module imports.
12. Soft-delete columns are `deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" })` (nullable). Filter `isNull(t.deletedAt)` in every read path; never delete rows for soft-deletable tables. See `references/soft-delete.md`.
13. Define relations with `relations(table, ({ one, many }) => ({...}))` in the same `schema.ts`. Re-export relations from the barrel alongside the tables.

### Repo layer (queries)

14. Only `repo.ts` files import the `db` instance. `service.ts`, `routes.ts`, and `schema.ts` MUST NOT import `db`.
15. Build queries with the SQL-like API (`db.select().from(t).where(...)`) for explicit projections. Use the relational API (`db.query.t.findMany({ with: {...} })`) for nested loads.
16. Use Drizzle operators (`eq`, `and`, `or`, `inArray`, `isNull`, `gte`, `lte`, `sql`). Never concatenate strings into raw SQL. Use the `sql` template tag for unavoidable raw fragments.
17. For hot read paths, define prepared statements at module load with `.prepare("<name>")` and use `db.placeholder("<key>")` parameters. See `references/prepared-statements.md`.
18. Treat the result row's column nullability literally — `noUncheckedIndexedAccess` + Drizzle's inferred types catch this if you do not widen with `as`.

### Transactions

19. Wrap every multi-statement write in `await db.transaction(async (tx) => { ... })`. Pass `tx` (not `db`) to every repo call inside the callback.
20. Throw to roll back. Returning early does NOT roll back. Never call `tx.rollback()` manually except to abort with a known sentinel.
21. Never nest `tx.transaction` for control flow; Drizzle implements it as a SAVEPOINT and the savepoint cost is real. Use it only for genuinely retryable inner units.
22. Cross-module calls from inside a transaction must accept `tx` as an argument (a module's public surface exposes `(tx, ...args)` overloads when needed). Never start a second top-level transaction from inside a running one.

### Drizzle Kit workflow

23. Configure Drizzle Kit at `apps/api/drizzle.config.ts` with `dialect: "postgresql"`, `schema: "./src/db/schema.ts"`, `out: "./src/db/migrations"`, `dbCredentials: { url: process.env.DATABASE_URL }`.
24. Generate migrations with `pnpm --filter api drizzle-kit generate`. Always commit BOTH the generated `.sql` file AND the `meta/` snapshot in the same commit.
25. Apply migrations with `pnpm --filter api drizzle-kit migrate`. This is what the one-shot `api-migrate` container runs. The long-running `api` service NEVER calls `migrate()` programmatically on boot.
26. For DDL Drizzle Kit cannot express (extensions, custom triggers, `CREATE INDEX CONCURRENTLY`), hand-edit the generated `.sql` file before commit. Drizzle Kit re-uses the existing file on the next `generate` if its `meta/_journal.json` entry is intact. See `references/migrations.md`.
27. Never edit a migration file that has already shipped (merged to `main`). Add a new migration that reverses or amends instead.
28. Never run `drizzle-kit push` against any environment. `push` skips the migrations folder; the project's source of truth is the committed SQL.

## Schema template

Annotated table definition — required fields marked, optional explicit.

```ts
// apps/api/src/modules/medical-record/schema.ts
import { pgTable, uuid, varchar, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { account } from "../accounts/schema"; // FK target, function form below

export const medicalRecord = pgTable(
  "medical_record", // REQUIRED: snake_case table name
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),                    // REQUIRED
    patientId: uuid("patient_id").notNull().references(() => account.id, {           // REQUIRED FK, function form
      onDelete: "restrict",                                                          // exhaustive: "cascade" | "restrict" | "set null" | "set default" | "no action"
    }),
    notes: varchar("notes", { length: 4000 }).notNull(),                             // REQUIRED column
    isShared: boolean("is_shared").notNull().default(false),                         // REQUIRED, has default
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })         // REQUIRED audit column
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })         // REQUIRED audit column
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),        // OPTIONAL (nullable) — soft-delete sentinel
  },
  (t) => ({
    byPatient: index("medical_record_patient_idx").on(t.patientId),                  // OPTIONAL: explicit index
  }),
);

export const medicalRecordRelations = relations(medicalRecord, ({ one }) => ({
  patient: one(account, { fields: [medicalRecord.patientId], references: [account.id] }),
}));
```

Barrel:

```ts
// apps/api/src/db/schema.ts — Drizzle Kit reads this
export * from "../modules/accounts/schema";
export * from "../modules/medical-record/schema";
export * from "../modules/scheduling/schema";
export * from "../modules/appointments/schema";
export * from "../modules/auth/schema";
```

Client:

```ts
// apps/api/src/shared/db.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../db/schema";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,                       // REQUIRED explicit
  idleTimeoutMillis: 30_000,     // REQUIRED explicit
  connectionTimeoutMillis: 5_000,// REQUIRED explicit
});

export const db = drizzle(pool, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
```

## Examples

### CORRECT — repo + transaction

```ts
// apps/api/src/modules/appointments/repo.ts
import { eq, and, isNull } from "drizzle-orm";
import type { Db, Tx } from "../../shared/db";
import { appointment } from "./schema";

export const findById = (db: Db | Tx, id: string) =>
  db.select().from(appointment).where(and(eq(appointment.id, id), isNull(appointment.deletedAt))).limit(1);

export const insert = (db: Db | Tx, row: typeof appointment.$inferInsert) =>
  db.insert(appointment).values(row).returning();
```

```ts
// apps/api/src/modules/appointments/service.ts
import { db } from "../../shared/db";
import * as repo from "./repo";
import { reserveSlot } from "../scheduling"; // public surface

export const book = (input: BookInput) =>
  db.transaction(async (tx) => {
    await reserveSlot(tx, input.slotId, input.patientId); // cross-module call accepts tx
    const [row] = await repo.insert(tx, { /* ... */ });
    return row; // throw to roll back; returning commits
  });
```

### CORRECT — hand-written initial migration enabling pgcrypto

```sql
-- apps/api/src/db/migrations/0000_init.sql (hand-edited after generate)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE "account" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- ...
);
```

WHY hand-edit: Drizzle Kit cannot emit `CREATE EXTENSION`. The `--> statement-breakpoint` marker is required between statements so the migration runner executes them separately.

### INCORRECT — auto-migrate on boot

```ts
// apps/api/src/main.ts
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./shared/db";

await migrate(db, { migrationsFolder: "./src/db/migrations" }); // BAD
// ... start Hono server
```

WHY wrong: violates Rule 25. The `api` service must not migrate. Migrations are applied by the one-shot `api-migrate` container running `drizzle-kit migrate` before `api` starts.

### INCORRECT — string column reference / wrong driver

```ts
import { drizzle } from "drizzle-orm/postgres-js";        // violates Rule 1
import postgres from "postgres";
const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client);                        // violates Rule 3 (no schema)

const rows = await db
  .select()
  .from(appointment)
  .where(eq("patient_id", id));                            // violates Rule 16 (raw string instead of column ref)
```

WHY wrong: Rule 1 mandates `node-postgres`. Rule 3 mandates passing `{ schema }`. Rule 16 mandates Drizzle operators with column references, not raw strings.

### INCORRECT — forgetting `tx`

```ts
import { db } from "../../shared/db";
import * as repo from "./repo";

export const book = (input: BookInput) =>
  db.transaction(async (tx) => {
    await repo.insert(db, /* ... */); // BAD: used `db`, not `tx`
  });
```

WHY wrong: violates Rule 19. Using `db` opens a second connection outside the transaction; the insert commits even if the transaction rolls back.

## References

- `references/migrations.md` — generate/migrate/hand-edit workflow, journal model, `statement-breakpoint`, rollback policy.
- `references/transactions.md` — isolation levels, retry on serialization failure, nested savepoints, cross-module `tx` plumbing.
- `references/prepared-statements.md` — `.prepare()` + `db.placeholder()`, when prepared statements help, lifecycle.
- `references/soft-delete.md` — `deletedAt` column convention, read-path filters, FK behavior, restore.
- `references/relations.md` — `one` vs `many`, junction tables, `with: {}` nesting, `findFirst` pitfalls.
