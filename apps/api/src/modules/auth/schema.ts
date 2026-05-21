import { sql } from 'drizzle-orm';
import { check, customType, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// citext is a Postgres extension type — represent it as a custom Drizzle type
// so generated DDL emits `citext` rather than `text`.
const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

/**
 * Minimal user table owned by the auth module.
 * The `accounts` module will adopt and extend this table when it lands;
 * do NOT add a second user table.
 *
 * Acceptance bullet 9 columns:
 *   id uuid pk, email citext unique, role text (check), password_hash text,
 *   created_at timestamptz, deleted_at timestamptz (null = not deleted).
 */
export const user = pgTable(
  'user',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    email: citext('email').notNull().unique(),
    role: text('role').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [check('user_role_check', sql`${t.role} IN ('patient', 'doctor')`)],
);

/**
 * Refresh token table (acceptance bullet 12).
 * hash: stored argon2id hash of the raw token value.
 * replacedBy: self-referential FK to the next rotation row (nullable).
 */
export const refreshToken = pgTable('refresh_token', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'restrict' }),
  hash: text('hash').notNull().unique(),
  issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  // Self-referential FK — function form required by Drizzle to resolve after declaration.
  replacedBy: uuid('replaced_by').references((): typeof refreshToken.id => refreshToken.id),
});
