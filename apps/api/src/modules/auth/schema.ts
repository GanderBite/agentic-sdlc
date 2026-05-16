import { relations, sql } from 'drizzle-orm';
import { check, customType, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// citext is a Postgres extension type (case-insensitive text).
// Drizzle does not ship a first-party column for it, so we declare one here.
const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

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

export const refreshToken = pgTable('refresh_token', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'restrict' }),
  hash: text('hash').notNull().unique(),
  issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  replacedBy: uuid('replaced_by').references(() => refreshToken.id),
});

export const userRelations = relations(user, ({ many }) => ({
  refreshTokens: many(refreshToken),
}));

export const refreshTokenRelations = relations(refreshToken, ({ one }) => ({
  user: one(user, { fields: [refreshToken.userId], references: [user.id] }),
  replacement: one(refreshToken, {
    fields: [refreshToken.replacedBy],
    references: [refreshToken.id],
  }),
}));
