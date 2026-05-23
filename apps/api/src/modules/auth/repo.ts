import { eq, and, isNull } from "drizzle-orm";

import type { Db, Tx } from "../../shared/db.js";
import { user } from "../accounts/schema.js";
import { refreshToken } from "./schema.js";

// ---------------------------------------------------------------------------
// User queries
// ---------------------------------------------------------------------------

/**
 * Returns the full user row including password_hash.
 * Returns undefined when the user does not exist or is soft-deleted.
 */
export async function findUserByEmail(
  db: Db | Tx,
  email: string,
): Promise<typeof user.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(user)
    .where(and(eq(user.email, email), isNull(user.deletedAt)))
    .limit(1);

  return rows[0];
}

// ---------------------------------------------------------------------------
// Refresh-token queries
// ---------------------------------------------------------------------------

export type InsertRefreshTokenInput = {
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
};

/**
 * Inserts a new refresh_token row and returns it.
 */
export async function insertRefreshToken(
  db: Db | Tx,
  input: InsertRefreshTokenInput,
): Promise<typeof refreshToken.$inferSelect> {
  const rows = await db
    .insert(refreshToken)
    .values({
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    })
    .returning();

  const row = rows[0];
  if (row === undefined) {
    throw new Error("insertRefreshToken: insert returned no rows");
  }
  return row;
}

/**
 * Looks up a refresh_token row by its hash.
 * Returns undefined when not found.
 */
export async function findRefreshTokenByHash(
  db: Db | Tx,
  hash: string,
): Promise<typeof refreshToken.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(refreshToken)
    .where(eq(refreshToken.tokenHash, hash))
    .limit(1);

  return rows[0];
}

/**
 * Revokes a single refresh_token row by id (sets revoked_at = now()).
 * Scoped to the single row — does NOT revoke sibling tokens for the same user.
 */
export async function revokeRefreshToken(
  db: Db | Tx,
  id: string,
  now: Date,
): Promise<void> {
  await db
    .update(refreshToken)
    .set({ revokedAt: now })
    .where(and(eq(refreshToken.id, id), isNull(refreshToken.revokedAt)));
}
