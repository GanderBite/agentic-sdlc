import { pgTable, pgEnum, uuid, text, timestamp, customType } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// citext is a PostgreSQL extension type (case-insensitive text).
// Drizzle does not have a built-in citext column helper, so we define one.
const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

export const userRoleEnum = pgEnum("user_role", ["patient", "doctor"]);

export const user = pgTable("user", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: citext("email").notNull().unique(),
  role: userRoleEnum("role").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
});
