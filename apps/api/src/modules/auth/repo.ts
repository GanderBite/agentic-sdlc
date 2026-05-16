import { and, eq, isNull, sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';

import { db } from '../../db/client.ts';
import { refreshToken, user } from './schema.ts';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type User = InferSelectModel<typeof user>;
export type RefreshToken = InferSelectModel<typeof refreshToken>;

export type RotatedRow = {
  id: string;
  userId: string;
  expiresAt: Date;
};

// ---------------------------------------------------------------------------
// User queries
// ---------------------------------------------------------------------------

/**
 * Looks up a non-deleted user by email.
 * The `email` column is `citext`, so the comparison is case-insensitive
 * without any LOWER() wrapping.
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
 * Inserts a new user row. Intended for seed / registration only.
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
  if (row === undefined) {
    throw new Error('insertUser: no row returned after insert');
  }
  return row;
}

// ---------------------------------------------------------------------------
// Refresh-token queries
// ---------------------------------------------------------------------------

/**
 * Inserts a new refresh-token row.
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
  if (row === undefined) {
    throw new Error('insertRefreshToken: no row returned after insert');
  }
  return row;
}

/**
 * Atomically marks a refresh token as revoked and returns its key fields.
 *
 * Single UPDATE … RETURNING statement — either the token was active and we
 * get one row back, or it was already revoked / never existed and we get
 * zero rows (returns null — caller should treat this as a replay attack).
 */
export async function rotateRefreshToken(hash: string): Promise<RotatedRow | null> {
  const result = await db.execute<{ id: string; user_id: string; expires_at: Date }>(
    sql`UPDATE refresh_token SET revoked_at = now() WHERE hash = ${hash} AND revoked_at IS NULL RETURNING id, user_id, expires_at`,
  );

  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at,
  };
}

/**
 * Finds a refresh token by hash regardless of revocation status.
 * Used for replay detection — a hit on a revoked token signals a
 * token-family compromise.
 */
export async function findRefreshTokenAnywhere(hash: string): Promise<RefreshToken | undefined> {
  const rows = await db.select().from(refreshToken).where(eq(refreshToken.hash, hash)).limit(1);

  return rows[0];
}

/**
 * Revokes all active refresh tokens for a user.
 * Called during token-family revocation (replay detected) or explicit logout.
 */
export async function revokeAllActiveForUser(userId: string): Promise<void> {
  await db.execute(
    sql`UPDATE refresh_token SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`,
  );
}
