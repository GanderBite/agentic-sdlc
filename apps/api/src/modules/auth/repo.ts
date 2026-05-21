/**
 * auth/repo.ts — sole file touching the Drizzle client for auth.
 *
 * Layering rule (ARCHITECTURE §2.3): routes → service → repo.
 * Only this file may import `db`.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { refreshToken, user } from './schema.js';

// ---------------------------------------------------------------------------
// Types inferred from the schema so callers never hand-write interfaces.
// ---------------------------------------------------------------------------

export type User = typeof user.$inferSelect;
export type RefreshToken = typeof refreshToken.$inferSelect;

/** Shape returned by the atomic rotate UPDATE ... RETURNING. */
export type RotatedRow = {
  id: string;
  userId: string;
  expiresAt: Date;
};

// ---------------------------------------------------------------------------
// User queries
// ---------------------------------------------------------------------------

/**
 * Look up a user by email.
 * The `email` column is `citext` so Postgres performs the case-insensitive
 * comparison; we pass the value verbatim (no transform) and let the DB do it.
 * Soft-deleted users (deletedAt IS NOT NULL) are excluded in the WHERE clause.
 */
export async function findUserByEmail(email: string): Promise<User | undefined> {
  const rows = await db
    .select()
    .from(user)
    .where(and(eq(user.email, email), isNull(user.deletedAt)))
    .limit(1);
  return rows[0];
}

/**
 * Look up a user by primary key.
 * Used by service.me() to hydrate the current user from a validated JWT claim.
 * Filters out soft-deleted users.
 */
export async function findUserById(id: string): Promise<User | undefined> {
  const rows = await db
    .select()
    .from(user)
    .where(and(eq(user.id, id), isNull(user.deletedAt)))
    .limit(1);
  return rows[0];
}

/**
 * Insert a new user row.
 * Intended for the seed only — production registration is out of scope for
 * this feature (acceptance § Out of scope).
 */
export async function insertUser(input: {
  email: string;
  role: string;
  passwordHash: string;
}): Promise<User> {
  const rows = await db
    .insert(user)
    .values({
      email: input.email,
      role: input.role,
      passwordHash: input.passwordHash,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('insertUser: no row returned');
  return row;
}

// ---------------------------------------------------------------------------
// Refresh-token queries
// ---------------------------------------------------------------------------

/**
 * Persist a new refresh token row.
 * The `hash` is the argon2id hash of the raw token value; the raw value is
 * never stored.
 */
export async function insertRefreshToken(input: {
  userId: string;
  hash: string;
  expiresAt: Date;
}): Promise<RefreshToken> {
  const rows = await db
    .insert(refreshToken)
    .values({
      userId: input.userId,
      hash: input.hash,
      expiresAt: input.expiresAt,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('insertRefreshToken: no row returned');
  return row;
}

/**
 * Atomic refresh-token rotation.
 *
 * Executes the single SQL statement:
 *   UPDATE refresh_token SET revoked_at = now() WHERE hash = $1 AND revoked_at IS NULL RETURNING id, user_id, expires_at
 *
 * Returns the rotated row if exactly one row was updated (the token was
 * active), or `null` when zero rows match (already revoked or unknown hash).
 * The atomicity prevents two concurrent refresh requests from both succeeding.
 *
 * Acceptance bullet 11 / Clarification §3.
 */
export async function rotateRefreshToken(hash: string): Promise<RotatedRow | null> {
  const result = await db.execute<{ id: string; user_id: string; expires_at: Date }>(
    sql`UPDATE refresh_token SET revoked_at = now() WHERE hash = ${hash} AND revoked_at IS NULL RETURNING id, user_id, expires_at`,
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at,
  };
}

/**
 * Find a refresh token row regardless of revocation status.
 * Used during replay detection: if the atomic rotate returns null but this
 * function finds the row, the token has been used before (replayed),
 * triggering token-family revocation.
 *
 * Acceptance bullet 12.
 */
export async function findRefreshTokenAnywhere(hash: string): Promise<RefreshToken | undefined> {
  const rows = await db.select().from(refreshToken).where(eq(refreshToken.hash, hash)).limit(1);
  return rows[0];
}

/**
 * Revoke every active refresh token for the given user.
 *
 * Executes:
 *   UPDATE refresh_token SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL
 *
 * Called after replay detection to implement token-family revocation.
 * Acceptance bullet 12 / Clarification §4.
 */
export async function revokeAllActiveForUser(userId: string): Promise<void> {
  await db.execute(
    sql`UPDATE refresh_token SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`,
  );
}
