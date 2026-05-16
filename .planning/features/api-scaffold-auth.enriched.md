---
slug: api-scaffold-auth
title: "API scaffold + authenticated login & session management"
primary_users: ["patient","doctor"]
depends_on: []
estimated_task_count: 22
enriched_at: 2026-05-16T00:00:00Z
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
- The initial migration creates a minimal `user(id uuid pk, email citext unique, role text, created_at timestamptz, deleted_at timestamptz null)` table inside `apps/api/src/modules/auth/schema.ts`; downstream `accounts` will adopt and extend this table when that feature lands (no rename / no second user table).
- JWT signing uses HS256 with a `JWT_SECRET` environment variable; `apps/api` boot fails fast with a clear error if `JWT_SECRET` is missing or shorter than 32 bytes (asserted by a startup test that loads the bootstrap module with an undersized secret and expects a thrown error).
- Refresh rotation is implemented as a single atomic SQL statement `UPDATE refresh_token SET revoked_at = now() WHERE hash = $1 AND revoked_at IS NULL RETURNING *`; an integration test fires two concurrent refresh requests against the same cookie and asserts exactly one returns 200 with a new token pair and the other returns 401.
- On replayed-refresh detection (the atomic UPDATE returns zero rows for a token whose hash is otherwise present in the table), the service revokes every active `refresh_token` row for the affected user (token-family revocation) and emits a single `level=warn` log line containing `userId` and `requestId`; asserted by an integration test that presents a previously-rotated refresh cookie and verifies (a) the response is 401, (b) all that user's refresh rows have non-null `revoked_at`, and (c) the captured log contains exactly one `warn` line with those two fields.
- The seed runs inline at the end of the `api-migrate` one-shot container (`drizzle-kit migrate && node dist/seed/main.js`); the seed is idempotent (re-running on a populated DB inserts zero rows and exits 0), asserted by an integration test that runs the seed twice against the same container.
- The argon2id `verify` function is injected into the auth service via constructor / factory dependency so a Vitest spy can replace it; the unknown-email and wrong-password integration tests each assert the spy was called exactly **once** per login attempt (closes the constant-time-verify-assertion clarification).

## Clarifications

- **Q: Where does the `user` table live for this feature, given `accounts` (its long-term owner per ARCHITECTURE §2.2) does not yet exist?**
  A: Ship a minimal `user(id, email, role, created_at, deleted_at)` table inside `auth/schema.ts` here; `accounts` will adopt and extend it when that feature lands.

- **Q: What signs the session JWT — HS256 with a shared secret, RS256 with a keypair, or a KMS-backed key?**
  A: HS256 with a `JWT_SECRET` env var (min 32 bytes), fail-fast on boot if missing or too short.

- **Q: How does refresh rotation handle two concurrent refresh attempts with the same cookie?**
  A: Atomic `UPDATE refresh_token SET revoked_at = now() WHERE hash = $1 AND revoked_at IS NULL RETURNING *` — exactly one request wins and issues a new pair; the loser sees zero rows and returns 401.

- **Q: When a replayed (already-revoked) refresh token is presented, do we just return 401, or do we additionally revoke the entire token family for that user?**
  A: Revoke the entire token family for that user (set `revoked_at` on every active refresh_token row for the user) and log a `warn` line with userId + requestId.

- **Q: Does the seed run as a separate compose service, or inline at the end of `api-migrate`?**
  A: Run inline at the end of `api-migrate` (one-shot container runs `drizzle-kit migrate` then `node dist/seed/main.js`); seed is idempotent so re-runs are safe.

- **Q: How is the "argon2 verify is called even for unknown emails" property asserted in tests — by timing, or by a stub/spy on the verify function?**
  A: Inject the argon2 verify function via the service-layer dependency boundary and assert with a Vitest spy that `verify` was called exactly once per login attempt in both the unknown-email and wrong-password tests.
