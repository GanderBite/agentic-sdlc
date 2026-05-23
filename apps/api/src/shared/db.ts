import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env["DATABASE_URL"],
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// The schema barrel (apps/api/src/db/schema.ts) is created in a later wave.
// We initialise drizzle here without a schema so this file compiles and
// runs before that wave lands.  Once db/schema.ts exists, main.ts should
// call `reinitWithSchema` (or replace this export) to enable the relational
// query API (db.query.*).
// The cast is intentional: drizzle accepts `{}` as a valid (empty) schema;
// the typed schema record will be supplied once the barrel exists.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = drizzle(pool, { schema: {} as any });

export type Db = typeof db;
// Tx is the argument type passed to a drizzle transaction callback
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
