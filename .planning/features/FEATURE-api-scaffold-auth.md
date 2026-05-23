---
slug: api-scaffold-auth
title: "API scaffold + authenticated login & session management"
primary_users: ["patient","doctor"]
depends_on: []
estimated_task_count: 22
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

