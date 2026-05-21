import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../shared/env.js';
import * as schema from './schema.js';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Factory — accepts a pre-constructed pool so tests and the production
 * bootstrap can each wire their own pool (avoids eager-singleton issues).
 */
export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}

// Default production pool — sized from env defaults.
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

/** Default singleton db used by all repo modules at runtime. */
export const db: Db = createDb(pool);

/**
 * End the pool on process shutdown. Called once from the server bootstrap
 * (SIGTERM / SIGINT handlers). Never call from request handlers.
 */
export async function closeDb(): Promise<void> {
  await pool.end();
}
