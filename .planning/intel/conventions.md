# Conventions

Snapshot: `1c8d5d1707e5aa47d37c987e847cd6ae0fcc2a41`.

Derived from the on-disk code after sprint-002 (`api-scaffold-auth`) landed the
pnpm workspace, `@medbridge/api`, and `@medbridge/contracts`. Everything below
is checked against real files; treat it as authoritative until the next
`intel-refresh`.

## Workspace topology

- `pnpm-workspace.yaml` declares `apps/*` and `packages/*` as workspace globs.
- Two workspaces exist on disk:
  - `apps/api` — `@medbridge/api` (Hono + Drizzle backend, ESM, `"type": "module"`).
  - `packages/contracts` — `@medbridge/contracts` (Zod schemas + shared types).
- Root `package.json` declares only meta scripts: `typecheck`, `lint`, `format`,
  and the Biome devDependency. There is no root `build` or root `test`.

## Naming

- **Files**: `kebab-case.ts` (e.g. `requestId.ts`, `errorHandler.ts`,
  `logCapture.ts`). Tests are `*.test.ts`; integration tests follow
  `<feature>.<scenario>.test.ts` (e.g. `auth.login.test.ts`, `auth.refresh.test.ts`).
- **Identifiers**: `camelCase` for values/functions, `PascalCase` for types and
  exported error classes, `UPPER_SNAKE_CASE` for module-private constants
  (`UNSAFE_METHODS`, `EXEMPT_PATHS`, `SESSION_MAX_AGE`).
- **Zod schemas**: lowerCamel for runtime schemas (`loginRequest`, `loginResponse`,
  `errorEnvelope`), PascalCase for the corresponding type (`LoginRequest`,
  `ErrorCode`). Schemas are colocated in `packages/contracts/src/<topic>.ts`.
- **DB columns**: `snake_case` in SQL (`password_hash`, `created_at`,
  `deleted_at`, `token_hash`), `camelCase` in Drizzle table objects via
  `column('snake_case')` (e.g. `passwordHash: text('password_hash')`).
- **Tables**: singular, snake_case (`user`, `refresh_token`).
- **Enums**: `pgEnum('user_role', [...])` — name in snake_case, values lowercase
  ('patient', 'doctor').
- **HTTP routes**: `POST /api/login`, `POST /api/refresh`, `POST /api/logout`,
  `GET /api/me`, `GET /api/health`. See `do-not-recur.md` (F-202): the auth
  routes currently use plain-slash (`/api/login`) but the architecture
  prescribes `/api/auth.<verb>`; that reconciliation is pending.
- **Env vars**: `UPPER_SNAKE_CASE` (`DATABASE_URL`, `JWT_SECRET`,
  `REFRESH_SECRET`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`,
  `NODE_ENV`, `LOG_LEVEL`, `PORT`).

## Layering

```
apps/api/src/
  main.ts                # boot: env validation → singletons → createApp → serve
  app.ts                 # createApp factory; middleware order + route mounting
  middleware/            # requestId, logger, csrf, authn, authz, errorHandler
  modules/
    accounts/schema.ts   # user table (read-only consumer for auth)
    auth/                # service.ts, repo.ts, routes.ts, dto.ts, throttle.ts, schema.ts, index.ts
  shared/                # db, errors, logger, password, ids, time
  db/
    schema.ts            # barrel; re-exports module-owned schema fragments
    migrations/          # drizzle-kit SQL + meta/_journal.json
  seed/                  # main.ts + fixtures/users.json

apps/api/test/
  integration/           # *.test.ts; Testcontainers Postgres, one container per file
  support/               # container, fixtures, logCapture, passwords, request, assertions

packages/contracts/src/
  auth.ts                # Role + auth request/response schemas
  common.ts              # ErrorCode enum + errorEnvelope
  index.ts               # barrel
```

- **Public boundary of a feature module**: `modules/<feature>/index.ts`
  re-exports only the factory and the types other layers need. `repo.ts`,
  `schema.ts`, `throttle.ts`, and `dto.ts` stay internal — `routes.ts` is the
  only file outside the module that may import them, and only via the module
  directory (not via deep file paths from unrelated modules).
- **Cross-module imports** go through `modules/<feature>/index.ts` or
  `modules/<feature>/schema.ts` when other tables need a foreign-key reference
  (e.g. `auth/schema.ts` imports `accounts/schema.ts`).
- **`shared/` is dependency-free of `modules/`**: it must not import from any
  feature module.
- **`db/schema.ts` is a barrel only** — drizzle-kit reads it to discover all
  tables in one import. Add a `export * from '../modules/<feature>/schema.js'`
  line when a new module ships its first table.

## Error handling

- All thrown application errors extend `AppError` (`apps/api/src/shared/errors.ts`).
  Subclasses set `code` (from `ErrorCode` in `@medbridge/contracts`) and
  `statusCode`. Currently provided: `ValidationError` (422),
  `UnauthorizedError` (401), `ForbiddenError` (403), `NotFoundError` (404),
  `ConflictError` (409), `UnsupportedMediaError` (415), `PayloadTooLargeError`
  (413), `TooManyRequestsError` (429).
- `errorHandler` (registered via `app.onError`) maps:
  - `AppError` → `{ error: { code, message?, details? } }` at `err.statusCode`.
  - Everything else → 500 with `{ error: { code: "INTERNAL" } }` (no details).
- The envelope shape is enforced by `errorEnvelope` in
  `packages/contracts/src/common.ts`.

## Logging

- Root logger lives in `apps/api/src/shared/logger.ts` (pino).
- **Redact paths (mandatory, do not remove)**: `req.headers.cookie`,
  `req.headers.authorization`, `req.headers["x-csrf-token"]`,
  `req.body.password`, `res.headers["set-cookie"]`. Censor token `[REDACTED]`,
  `remove: false`.
- Per-request child logger in `middleware/logger.ts` adds `{ requestId, method, path }`
  bindings; emits one `request.complete` line per request with
  `{ requestId, method, path, status, durationMs, userId? }`.
- `LOG_LEVEL` env defaults to `info`.
- Sensitive values (passwords, raw tokens, JWTs) MUST NOT be logged outside
  the redaction paths above. Add a redaction path before logging a new
  sensitive field.

## Auth & security invariants

- **Password hashing**: argon2id via `apps/api/src/shared/password.ts`.
  `verify(hash, plaintext)` is called exactly once per login attempt even when
  the user does not exist (constant-time defence, ref B7/B13 in the agent
  memory — see `do-not-recur.md`).
- **Session JWT**: HS256 via `jose`, signed in `main.ts`. Verification in
  `middleware/authn.ts` pins `algorithms: ['HS256']` and uses
  `clockTolerance: 5` (ARCHITECTURE §B12 — 5-second clock skew window).
- **Cookies** (all path `/`, `secure: true`, `sameSite: Lax`):
  - `session` — HttpOnly, `maxAge = 15 * 60` (15 minutes).
  - `refresh_token` — HttpOnly, `maxAge = 7 * 24 * 60 * 60` (7 days).
  - `csrf_token` — NOT HttpOnly (must be readable by browser JS for
    double-submit), `maxAge = 7 days` to match refresh.
- **CSRF**: double-submit cookie. `UNSAFE_METHODS = {POST, PATCH, DELETE}`.
  `EXEMPT_PATHS = {/api/login, /api/refresh}`. Header is `X-CSRF-Token`;
  comparison uses `timingSafeEqual` (constant time).
- **Refresh-token storage**: `refresh_token.token_hash` stores a sha256 hex of
  the raw cookie value (`main.ts:hashRefreshToken`). The plaintext token is
  never persisted.
- **Login throttle**: per `(ip, lowercased-email)` rolling window, 10
  attempts / 15 minutes, in-memory (`modules/auth/throttle.ts`).
- **JWT_SECRET** must be ≥32 chars (validated at boot in `main.ts`).
- **No public sign-up**: accounts are only created via the seed script
  (`src/seed/main.ts`) — there is no registration route.

## Configuration

- Env loaded directly via `process.env['...']` (no `.env` loader in
  production code). `.env.example` documents the required vars.
- Required at boot (fail-fast in `main.ts`): `JWT_SECRET` (≥32 chars),
  `DATABASE_URL`.
- Optional with defaults: `PORT` (default `3000`), `LOG_LEVEL` (default `info`),
  `NODE_ENV`.
- `apps/api/src/shared/db.ts` builds the `pg.Pool` from `DATABASE_URL`:
  `max: 10`, `idleTimeoutMillis: 30_000`, `connectionTimeoutMillis: 5_000`.

## TypeScript

- `tsconfig.base.json` at the root sets:
  - `strict: true`, `exactOptionalPropertyTypes: true`,
    `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`,
    `noPropertyAccessFromIndexSignature: true`,
    `forceConsistentCasingInFileNames: true`, `isolatedModules: true`.
  - `target: ESNext`, `module: ESNext`, `moduleResolution: NodeNext`,
    `esModuleInterop: false`, `allowSyntheticDefaultImports: true`.
  - Emits declarations + maps; `skipLibCheck: true`.
- Per-package tsconfigs extend the base.
- ESM imports use the `.js` extension (NodeNext resolution) even when the
  source file is `.ts`: e.g. `import { ... } from './service.js';`.

## Linting / formatting

- Biome v2 is the only linter/formatter (`biome.json`).
- Linter rules: `recommended`, plus `correctness.noUnusedImports: error`,
  `style.useImportType: error`, `suspicious.noExplicitAny: error`.
  Test files override `noExplicitAny` to `off`.
- Formatter: 2-space indent, line width 100, LF endings, single quotes in JS,
  semicolons always, trailing commas `all` in JS / `none` in JSON,
  arrow parens always.
- Ignored paths: `dist`, `build`, `coverage`, `**/node_modules`,
  `**/migrations/meta`, `pnpm-lock.yaml`, `.turbo`.

## Test conventions

See `test-layout.md` for the full layout. Key rules:

- **Do not mock the database**: integration tests use
  `@testcontainers/postgresql` (one container per test file).
- **Do not mock argon2, jose, or the CSRF token generator** in integration
  tests — each must be exercised end-to-end at least once per suite.
- **Module spy targets**: spy on the production module path, not a re-export
  helper. Live ESM bindings mean `vi.spyOn(testHelper, 'verify')` will not
  intercept calls made by the service from `src/shared/password.js`. See
  `do-not-recur.md` (F-001) and the agent-memory entry
  `sprint002_harness_spy_indirection.md`.
- **Log redaction is verified explicitly** (`apps/api/test/integration/log-redaction.test.ts`).
- **Unit tests are colocated** (`*.test.ts` next to `*.ts`) once they exist;
  no `__tests__/` folders, no `.spec.ts`.

## Database conventions

See `schema.md` for table-by-table details.

- Drizzle ORM + Drizzle Kit. Schema source: `apps/api/src/db/schema.ts`
  (barrel). Migrations: `apps/api/src/db/migrations/*.sql` with statement
  breakpoints and `meta/_journal.json`.
- All domain tables use `uuid` PKs defaulted via `gen_random_uuid()` (the
  `pgcrypto` extension is enabled in the init migration).
- The `citext` extension is enabled for case-insensitive `email`. A
  `customType<{ data: string }>` Drizzle helper provides the column type.
- Soft delete via `deletedAt` (`timestamp with time zone`); queries filter
  `isNull(user.deletedAt)`.
- Foreign keys use `references(() => target, { onDelete: 'restrict' })` for
  user references.

## Open architectural debt

- **F-202** — auth route path mismatch (`/api/<verb>` vs `/api/auth.<verb>`),
  see `csrf.ts:21` and `do-not-recur.md`.
- **F-205** — `dto.ts` round-trips JWTs to read claims; prefer
  `buildLoginResponseFromClaims` / `buildRefreshResponseFromClaims`.
- **F-208** — `src/seed/main.ts` accesses `accounts/schema.user` directly;
  move queries into `accounts/repo.ts` once that file exists.

Re-derive this document after the next merge that changes any of:
manifests (`package.json`), `biome.json`, `tsconfig*.json`, middleware,
`shared/`, or module boundaries.
