# Conventions

Derived from the code currently on disk under `apps/api/`, `packages/contracts/`, `biome.json`, `tsconfig.base.json`, and the auth module that landed in sprint-001. Update this file via `intel-refresh` after any sprint that introduces new conventions.

## Naming

- **Filenames**: `camelCase.ts` for TypeScript modules (e.g. `errorHandler.ts`, `requestId.ts`, `logCapture.ts`). Tests are `<unit>.test.ts` (unit, colocated) under `src/` and `<feature>.<scenario>.test.ts` (integration) under `test/integration/`.
- **Variables / functions**: `camelCase`.
- **Types / classes / Zod schemas exported as types**: `PascalCase` (e.g. `AuthService`, `ValidationError`, `LoginRequest`).
- **Zod schema instances**: `camelCase` (e.g. `loginRequest`, `errorEnvelope`, `userShape`).
- **Constants and env keys**: `SCREAMING_SNAKE_CASE` (e.g. `JWT_SECRET`, `REDACT_PATHS`, `FAKE_STORED_HASH`).
- **DB tables and columns**: `snake_case`, **singular** table names (`user`, `refresh_token`; columns `password_hash`, `expires_at`). This matches the current Drizzle output; do not pluralise.
- **HTTP routes**: action-style under `/api` or root (`/auth.login`, `/auth.refresh`, `/auth.me`, `/auth.logout`, `/api/health`). Auth uses dot-action verbs, not REST nouns.

## Layering

- pnpm-workspaces monorepo: `apps/*` (deployables) and `packages/*` (shared libs). `pnpm-workspace.yaml` registers both globs.
- `apps/api` layering (observed in `src/modules/auth/`): `routes.ts` → `service.ts` → `repo.ts` → `db/`. Shared cross-cutting helpers live in `apps/api/src/shared/` (`env`, `errors`, `http`, `logger`, `ids`, `time`).
- Cross-app/shared contracts live in `packages/contracts` and are imported as `@medbridge/contracts`. Do not duplicate Zod schemas in `apps/*` — import from contracts.
- DB schema is centralised: `apps/api/src/db/schema.ts` re-exports `apps/api/src/modules/auth/schema.ts`. New modules that introduce tables should follow the same pattern (define table in `modules/<name>/schema.ts`, re-export from `db/schema.ts`).
- `apps/api/src/main.ts` is the only side-effect entry point: it loads env first, then builds the Hono app via `buildApp(env)` (exported for tests so no port is bound under `NODE_ENV=test`).

## Public / private boundaries

- Each module exposes a barrel `index.ts` (e.g. `modules/auth/index.ts`) that re-exports only what other modules need (`createAuthService`, `wireAuth`, key types). Anything not re-exported is internal and must not be imported across module boundaries.
- `packages/contracts/src/index.ts` re-exports `./auth.js`; consumers import from the package name (`@medbridge/contracts`), never reach into `packages/contracts/src/*.ts` paths.
- ESM only (`"type": "module"`). Internal relative imports use the `.js` extension even for `.ts` source — required by NodeNext module resolution.

## Error handling

- `apps/api/src/shared/errors.ts` defines `AppError` and concrete subclasses (`ValidationError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `UnsupportedMediaError`, `PayloadTooLargeError`). Every thrown domain error must be an `AppError` so `errorHandler` can map it to the `{ error: { code, message, details? } }` envelope defined in `@medbridge/contracts` (`errorEnvelope`, `AuthErrorCode`).
- `ErrorCode` (api side) and `AuthErrorCode` (contracts side) are kept in sync — adding a new code requires updating both.
- Validate every external payload at the boundary with Zod (`safeParse`); throw `ValidationError(message, parsed.error.flatten())` on failure. Do not let raw Zod errors leak into the response.
- Never leak stack traces in production responses; the error handler is the only place that decides what reaches the client.

## Logging

- `pino` is the only logger. `apps/api/src/shared/logger.ts` exports the configured singleton and `withRequestId(requestId, userId?)` for per-request child loggers.
- **Redaction is mandatory.** `REDACT_PATHS` in `shared/logger.ts` censors `req.headers.cookie`, `req.headers['set-cookie']`, `req.headers['x-csrf-token']`, and any `*.password` field. Never log raw tokens, raw cookies, password hashes, or PHI. Add new paths to `REDACT_PATHS` when a new sensitive field appears.
- Request logging is handled by `middleware/logger.ts`; per-request fields are `{ requestId, method, path, status, durationMs, userId? }`.
- Log levels: `error` (handled exception), `warn` (security-relevant, e.g. token reuse), `info` (lifecycle), `debug` (off in prod). Level defaults to `info`; controlled via `LOG_LEVEL` env (`debug` | `info` | `warn` | `error`).

## Configuration

- Environment is parsed once via `loadEnv(process.env)` at the top of `main.ts` and cached as the `env` singleton (`shared/env.ts`). Modules import `env` from there, never read `process.env` directly.
- Required env: `DATABASE_URL` (url), `JWT_SECRET` (≥32 bytes). Defaults: `SESSION_TTL=900`, `REFRESH_TTL=604800`, `UPLOAD_DIR=/var/lib/medbridge/uploads`, `LOG_LEVEL=info`, `NODE_ENV=development`, `CORS_ORIGIN=http://localhost:5173`. Missing/invalid env aborts process start.
- Cookie security flags are centralised in `shared/http.ts` (`sessionCookieOptions`, `refreshCookieOptions`, `csrfCookieOptions`). Routes must use those presets — do not hand-roll cookie flags per-route.

## TypeScript

- `tsconfig.base.json` is `strict: true`, `module: NodeNext`, `target: ESNext`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`, `forceConsistentCasingInFileNames: true`. Composite projects via `tsc -b`.
- `verbatimModuleSyntax` means `import type` / `export type` are not optional — Biome's `style.useImportType: error` rule enforces it.
- `@medbridge/contracts` has `composite: true` + `emitDeclarationOnly: true`; `@medbridge/api` outputs JS via `tsc -b` and ships migrations into `dist/db/migrations` for the runtime container.

## Linting / Formatting (Biome)

- `biome.json` is the single source of truth. `biome check apps packages` is the lint command at the repo root; per-module `biome check src` is used by package scripts.
- Notable enabled rules: `correctness.noUnusedImports: error`, `style.useImportType: error`, `suspicious.noExplicitAny: error`. Recommended rules are on.
- Formatting: 2-space indent, 100-column line width, LF line endings, single quotes, semicolons always, trailing commas everywhere (JSON files: no trailing commas).
- Biome ignores: `dist/**`, `build/**`, `**/migrations/meta/**`, `.relay/**`, `.planning/**`, `.claude/**`, `scripts/**`, `pnpm-lock.yaml`.

## Test conventions

See `test-layout.md` for full details. Highlights:

- Backend only (no UI yet); two vitest projects in `apps/api/vitest.config.ts`: `unit` (colocated `src/**/*.test.ts`) and `integration` (`test/integration/**/*.test.ts`, run serially in a single fork).
- Integration tests hit a **real** Postgres via `@testcontainers/postgresql`. Do not mock the database, the password hasher, or the JWT signer in integration tests — these are exercised end-to-end at least once.
- Test helpers live in `apps/api/test/support/` (`db.ts`, `fixtures.ts`, `logCapture.ts`, `passwords.ts`, `request.ts`). Reuse them; do not re-implement DB bootstrap or HTTP wrappers per test file.

## Security invariants

- JWT with refresh-token rotation; refresh tokens stored as hashes in `refresh_token`, never as plaintext. Rotation on each `/auth.refresh`; old token revoked.
- Argon2 password hashing via `defaultPasswordHasher` (DI'd into `createAuthService` so unit tests can stub it).
- Constant-time login: unknown emails still call `hasher.verify` against `FAKE_STORED_HASH` so timing does not leak user existence (`service.ts`).
- CSRF: double-submit cookie. `/auth.login` and `/auth.refresh` are exempt (no prior cookie); `/auth.logout` and any future state-changing route require both `csrf` and `authn` middleware.
- Cookies: `httpOnly + secure + sameSite=Lax`. CSRF cookie is the only non-httpOnly cookie (JS must echo its value in `X-CSRF-Token`).
- Soft delete is the policy: `user.deleted_at`. Queries default to `WHERE deleted_at IS NULL` (see `repo.findUserByEmail`).

## Accessibility

- WCAG 2 AAA is a product requirement (per `docs/APPLICATION.md`). UI work has not started; once it does, any non-AAA contrast/focus/keyboard regression is a release blocker.
