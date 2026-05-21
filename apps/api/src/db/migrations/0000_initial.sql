-- Migration: 0000_initial
-- Enables pgcrypto (gen_random_uuid) and citext extensions,
-- then creates the auth module tables: "user" and "refresh_token".

CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE TABLE "user" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" citext NOT NULL,
  "role" text NOT NULL,
  "password_hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "user_role_check" CHECK (role IN ('patient', 'doctor')),
  CONSTRAINT "user_email_unique" UNIQUE ("email")
);
--> statement-breakpoint
CREATE TABLE "refresh_token" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "hash" text NOT NULL,
  "issued_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "replaced_by" uuid,
  CONSTRAINT "refresh_token_hash_unique" UNIQUE ("hash"),
  CONSTRAINT "refresh_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "refresh_token_replaced_by_refresh_token_id_fk" FOREIGN KEY ("replaced_by") REFERENCES "refresh_token"("id")
);
