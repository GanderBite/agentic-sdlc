---
slug: api-scaffold-auth
title: "API scaffold + authenticated login & session management"
primary_users: ["patient","doctor"]
depends_on: []
estimated_task_count: 22
enriched_at: 2026-05-23T00:00:00Z
---

# API scaffold + authenticated login & session management

## Summary

Bootstraps the pnpm workspace, packages/contracts, docker-compose, Drizzle migrations, and the auth module so seeded users can authenticate over HTTP with JWT + refresh rotation + CSRF.

## Scope

- pnpm workspaces with apps/api and packages/contracts plus root biome + tsconfig
- docker-compose services: postgres, api-migrate (one-shot), api
- Drizzle setup with pgcrypto extension and the initial migration committed
- AppError taxonomy + errorHandler, requestId, pino logger, csrf, authn (jose), authz middleware
- argon2id password hashing util and refresh_token table with hash-on-use rotation
- auth.login, auth.logout, auth.refresh, auth.me RPC routes with Zod contracts
- Vitest + @testcontainers/postgresql harness with one Postgres container per integration test file
- Minimal seed creating at least one patient and one doctor with hashed credentials

## Out of scope

- Frontend / UI (apps/ui scaffold ships in ui-scaffold-login)
- Self-service signup, password reset, email verification
- OAuth / SSO / 2FA
- Full-scale seed data (deferred to seed-and-deployment-smoke)

## Acceptance bullets

- `pnpm install --frozen-lockfile` succeeds at the repo root and `pnpm -r typecheck` exits 0 across apps/api and packages/contracts.
- `docker compose up postgres api-migrate api` results in `api` reporting healthy on `/api/health`, with `api-migrate` exiting 0 before `api` starts.
- POST /api/auth.login with valid seeded credentials returns HTTP 200, sets HttpOnly+Secure `session` and `refresh_token` cookies plus a non-HttpOnly `csrf_token` cookie, and returns `{ user: { id, email, role } }`; invalid credentials return HTTP 401 with `{ error: { code: "UNAUTHORIZED" } }` and no cookies.
- POST /api/auth.refresh rotates the refresh token (old hash revoked, new hash stored); a replayed refresh cookie returns HTTP 401.
- GET /api/auth.me returns the current user on a valid session cookie and HTTP 401 otherwise; POST /api/auth.logout clears both cookies and revokes the active refresh-token row.
- Any state-changing route invoked without a matching `X-CSRF-Token` header to the `csrf_token` cookie returns HTTP 403 with `{ error: { code: "FORBIDDEN" } }`.
- An integration test attempting login with an unknown email still incurs an argon2id verify (constant-time path) — asserted by measuring that unknown-email and wrong-password code paths both branch through the hashing call.
- A log-capture integration test asserts no API log line emitted during auth flows contains a password, JWT, refresh token, or CSRF token value.
- Session JWTs are signed and verified with **HS256** using a single shared secret read from the `JWT_SECRET` env var; the API refuses to boot when `JWT_SECRET` is missing or shorter than 32 characters, and an integration test mints a token with HS384 and asserts authn rejects it with HTTP 401.
- Refresh-token reuse detection is **scoped to the replayed hash only**: when a refresh cookie whose hash is already `revoked_at IS NOT NULL` (or absent) is presented, the route returns HTTP 401 and ensures the offending row is `revoked_at = now()`, but every other still-active `refresh_token` row for the same user remains untouched. An integration test creates two active refresh tokens for one user, replays the first (already-rotated) one, and asserts the second token still authenticates a subsequent `auth.refresh` successfully.
- The `accounts` schema in this feature ships **only the `user` table** with columns `id uuid pk default gen_random_uuid()`, `email citext unique not null`, `role` (enum `'patient' | 'doctor'`), `password_hash text not null`, `created_at timestamptz not null default now()`, `deleted_at timestamptz null`; `patient_profile` / `doctor_profile` / `specialization` / `doctor_specialization` tables are explicitly deferred to later features and MUST NOT appear in this migration.
- `auth.login` is protected by an **in-memory IP+email throttle** wired through the auth service: 10 attempts per rolling 15-minute window per `(remoteIp, lowercased(email))` pair; the 11th attempt within the window returns HTTP 429 with `{ error: { code: "TOO_MANY_REQUESTS" } }` regardless of credential validity, and the counter naturally drains as old timestamps fall out of the window. An integration test fires 11 same-IP, same-email login requests against `auth.service` and asserts exactly the first 10 reach the argon2 verify spy while the 11th short-circuits to 429.
- Seed credentials are sourced from a **JSON fixture file at `apps/api/src/seed/fixtures/users.json`** consumed by `apps/api/src/seed/main.ts`; the fixture lists at least one patient and one doctor with plaintext passwords that the seeder hashes via the production argon2id util before insert. The seeder is idempotent — re-running on a populated DB inserts zero rows and exits 0 — asserted by an integration test that runs the seed twice against the same testcontainer.
- pino is configured with a `redact` paths config covering at minimum `req.headers.cookie`, `req.headers.authorization`, `req.headers["x-csrf-token"]`, `req.body.password`, and `res.headers["set-cookie"]`; an integration test captures stdout while exercising `auth.login`, `auth.refresh`, and a CSRF-failing POST, then greps the captured lines and asserts the literal values of the seeded password, the issued JWT, the issued refresh token, and the issued CSRF token do **not** appear in any captured byte.

## Clarifications

- **Q: Which JWT signing algorithm and key material does the auth module use?**
  A: HS256 with a single shared secret from `JWT_SECRET` env (recommended).

- **Q: When a refresh-token reuse is detected, which sessions are revoked?**
  A: Revoke only the replayed hash; leave any other active sessions alone.

- **Q: What is the accounts schema scope for this feature?**
  A: `user` table only (id, email, role enum, password_hash); patient_profile/doctor_profile deferred to later features (recommended).

- **Q: How is login throttled to defend against credential-stuffing?**
  A: Minimal in-memory IP+email throttle (e.g. 10 attempts / 15 min) wired through the auth service.

- **Q: Where do seed credentials come from?**
  A: JSON fixture file under `apps/api/src/seed/fixtures/` consumed by the seeder.

- **Q: How is pino configured to keep secrets out of logs?**
  A: pino `redact` paths config (cookies, authorization, body.password, etc.) + integration test capturing stdout and grep-asserting absence of literal secret values (recommended).
