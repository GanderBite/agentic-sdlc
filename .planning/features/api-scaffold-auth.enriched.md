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
- Refresh rotation is **strict single-use with token-family revocation**: when two requests present the same refresh cookie, exactly one wins with a new pair (HTTP 200) and the other returns HTTP 401; replaying a previously-rotated refresh cookie returns HTTP 401 AND sets `revoked_at = now()` on every still-active `refresh_token` row for the affected user, with a single `level=warn` log line carrying `userId` and `requestId`. Integration tests assert (a) the concurrent-refresh race produces exactly one 200 and one 401, (b) the replay path leaves zero `revoked_at IS NULL` rows for that user, and (c) the captured log holds exactly one matching `warn` entry.
- `auth.login` is protected by a **per-IP fixed-window throttle of 10 attempts / 15 minutes**, held in an in-memory map keyed by `ctx.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? remoteAddr`; the 11th attempt within the window returns HTTP 429 with `{ error: { code: "TOO_MANY_REQUESTS" } }` regardless of credential validity, and the counter resets at the next window boundary. An integration test fires 11 requests from a single simulated IP and asserts the first 10 reach the password-verify path while the 11th short-circuits to 429 without invoking the argon2 verify spy.
- The seed source lives at `apps/api/src/seed/fixtures.ts` as **hardcoded fixtures**: deterministic emails (e.g. `patient@medbridge.test`, `doctor@medbridge.test`) and deterministic plaintext passwords hashed at seed time; both the email/password pairs are documented in `apps/api/README.md` under a "Seed credentials" heading. The seeder is idempotent — re-running on a populated DB inserts zero rows and exits 0 — asserted by an integration test that runs the seed twice against the same testcontainer.
- JWT verification uses **`jose`'s default 5-second clock skew tolerance** (no override of `clockTolerance`). An integration test mints a token with `exp` set 4 seconds in the past and asserts authn passes; a token with `exp` 6 seconds in the past asserts authn fails with HTTP 401.
- The argon2id `verify` function is exposed as an injectable dependency of the auth service (constructor / factory parameter) so a Vitest spy can replace it; the unknown-email and wrong-password integration tests each assert the spy was invoked **exactly once** per login attempt — closing the constant-time-verify property without relying on wall-clock timing.
- pino is configured with `redact: { paths: ["req.headers.cookie", "req.headers[\"x-csrf-token\"]", "req.body.password", "res.headers[\"set-cookie\"]"], remove: false, censor: "[REDACTED]" }`; a log-capture integration test exercises `auth.login`, `auth.refresh`, and a CSRF-failing POST, and asserts every captured line whose redaction-target field is present renders the literal `[REDACTED]` (and never a plaintext password, JWT, refresh token, CSRF token, or `Set-Cookie` header value).

## Clarifications

- **Q: How are two concurrent refresh attempts with the same cookie handled — first wins, retry window, or token-family revoke?**
  A: Strict single-use: first wins, second returns HTTP 401 and revokes the whole refresh-token family for that user (recommended).

- **Q: How is login throttled to defend against credential-stuffing?**
  A: Per-IP fixed-window limiter (10 attempts / 15 min), held in-memory in the `auth` module.

- **Q: Where do seed credentials come from?**
  A: Hardcoded fixtures in `apps/api/src/seed` with deterministic emails + plaintext passwords, documented in `apps/api/README.md` (recommended).

- **Q: What JWT clock-skew tolerance does authn apply when verifying the session token?**
  A: 5 seconds — the `jose` library default, not overridden (recommended).

- **Q: How is the "argon2 verify runs on every login attempt, even unknown emails" property asserted in tests?**
  A: Spy on the password-hash module's `verify` function and assert call count `== 1` for both the unknown-email and wrong-password test cases (recommended).

- **Q: How is pino configured to keep secrets out of logs?**
  A: Configure pino `redact` paths covering `req.headers.cookie`, `req.headers['x-csrf-token']`, `req.body.password`, and `res.headers['set-cookie']` (recommended).
