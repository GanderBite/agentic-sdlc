# TECH_STACK — MedBridge

> Concrete tooling commitment for MedBridge. Every row is a single choice with a current-stable version pin. The `skill-author` step will produce one `.claude/skills/` package per chosen tool (plus the testing-strategy skills enumerated in §10).
>
> Grounded in `docs/APPLICATION_BRIEF.md` and `docs/ARCHITECTURE.md`. Architecture pre-committed: modular monolith, single Postgres, Hono+React, Drizzle ORM, Zod v4, pnpm workspaces, docker compose. This document closes the remaining open questions the architecture step deferred to `tech-stack` (test runner, linter, JWT library, JSON logger, integration-test DB strategy).

---

## 1. Languages

| Language | Version | Used for |
|---|---|---|
| **TypeScript** | `5.7.x` (`^5.7`) | Primary. All source under `apps/api`, `apps/ui`, `packages/contracts`. `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. |
| **SQL** | PostgreSQL 17 dialect | Secondary. Committed Drizzle Kit-generated migration files under `apps/api/src/db/migrations/`. Hand-written only when Drizzle Kit cannot express the migration (e.g. `gen_random_uuid` default via `pgcrypto`). |

No JavaScript source files. No Python, no Go, no shell beyond `package.json` scripts and `docker-compose.yml`.

## 2. Runtime

- **Node.js `25.x`** (current stable). Pinned in `package.json` `"engines": { "node": ">=25.0.0 <26" }` and in `.nvmrc`.
- Both `apps/api` (Hono server) and the build-time tooling for `apps/ui` (Vite, Drizzle Kit) run on the same Node major. There is no Bun, no Deno, no edge runtime — `apps/api` is plain Node hosting `@hono/node-server`.
- Container image: `node:25-alpine` for `api` and `ui-build`; `node:25-alpine` also for the `api-migrate` and `seed` one-shots.

## 3. Package manager

- **pnpm `10.x`** (`^10.0.0`). Pinned via `"packageManager": "pnpm@10.x.x"` in the root `package.json` and enforced by `corepack`.
- Workspaces are declared in `pnpm-workspace.yaml`. The three workspace packages are `apps/api`, `apps/ui`, `packages/contracts` (architecture §2.1).
- Lockfile (`pnpm-lock.yaml`) is committed. `pnpm install --frozen-lockfile` runs in CI and in every docker build step.

## 4. Frameworks

### 4.1 Backend (`apps/api`)

| Concern | Choice | Version |
|---|---|---|
| HTTP framework | **Hono** | `^4.6.x` |
| Node adapter | **@hono/node-server** | `^1.13.x` |
| Validation | **Zod** | `^4.0.x` (brief §6) |
| ORM | **Drizzle ORM** | `^0.38.x` |
| Migration tool | **Drizzle Kit** | `^0.30.x` |
| Postgres driver | **node-postgres (`pg`)** | `^8.13.x` (single pool, used by Drizzle's `pg` driver — NOT `postgres.js`, NOT `@neondatabase/serverless`) |
| Password hashing | **`argon2`** | `^0.41.x` (native binding; argon2id, parameters `m=19456 KiB, t=2, p=1` matching OWASP 2024 baseline) |
| JWT library | **`jose`** | `^5.9.x` (closes architecture §8 open question 3: stateless JWT for the 15-min session, server-side `refresh_token` row for the 7-day refresh — `jose` supports both without forcing one shape) |
| Logger | **`pino`** | `^9.5.x` (`pino-pretty` only in dev) |
| Multipart parsing | Hono's built-in `c.req.parseBody` | n/a (no extra dep — architecture §3.2) |

### 4.2 Frontend (`apps/ui`)

| Concern | Choice | Version |
|---|---|---|
| Framework | **React** | `^19.0.x` |
| Build / dev server | **Vite** | `^7.0.x` (with `@vitejs/plugin-react`) |
| Router | **TanStack Router** | `^1.95.x` (file-based route tree, type-safe links — brief §12) |
| Data fetching | **TanStack Query** | `^5.62.x` |
| Styling | **Tailwind CSS** | `^4.0.x` (brief §12; `@tailwindcss/vite` plugin, no PostCSS config) |
| Component primitives | **Shadcn UI** (Radix-based) | latest CLI; copy-in components, no runtime package |
| Form state | **react-hook-form** | `^7.54.x` (paired with `@hookform/resolvers/zod` against shared `packages/contracts` schemas) |
| HTTP client | hand-written `fetch` wrapper under `apps/ui/src/api/` | n/a (brief §6 mandates hand-written typed client — no `ky`, no `axios`, no Hono RPC client) |

### 4.3 Shared (`packages/contracts`)

- **Zod `^4.0.x`** is the only runtime dependency. Exports one Zod schema per RPC operation (request + response) plus the inferred TS types. Both `apps/api` and `apps/ui` import from this package via the pnpm workspace `workspace:*` protocol.

## 5. Datastore + ORM/driver

- **Datastore:** **PostgreSQL `17.x`** (container image `postgres:17-alpine`). Single database, single schema (`public`), single connection pool per `apps/api` process. `pgcrypto` extension enabled in the initial migration to provide `gen_random_uuid()`.
- **ORM:** **Drizzle ORM `^0.38.x`** with the `pg` driver. Schema files live under `apps/api/src/modules/*/schema.ts` and are re-exported via `apps/api/src/db/schema.ts` (the Drizzle Kit barrel — architecture §4.2).
- **Migrations:** **Drizzle Kit `^0.30.x`** generates SQL into `apps/api/src/db/migrations/`. The committed SQL files are applied by a one-shot `api-migrate` container running `drizzle-kit migrate` (architecture §4.3). The long-running `api` service NEVER auto-migrates on boot.
- **Document blobs:** bind-mounted `uploads/` directory on the host (architecture §4.1). No object store, no `bytea`.

## 6. Test runner + assertion library

- **Vitest `^2.1.x`** is the single test runner for `apps/api`, `apps/ui` (where tests exist), and `packages/contracts`. Closes architecture §6.3 dev-deps decision and brief §14's "vitest vs node:test" handoff.
- Assertion API: Vitest's built-in `expect` (Jest-compatible). No Chai, no separate matcher library.
- **Unit tests** (`*.test.ts` colocated with source) run with the default `node` environment.
- **API integration tests** (`apps/api/test/integration/*.test.ts`) run against a **real Postgres** instance started by **`@testcontainers/postgresql` `^10.13.x`**, one container per test file, schema applied via the same `drizzle-kit migrate` used in production. Closes architecture §8 open question 7 in favour of testcontainers over per-test transaction rollback — file-scoped containers are slower per file but eliminate state leakage between describes and let multi-statement transactions in service code run unmodified.
- **No UI unit, component, or e2e tests** (brief §8). `apps/ui` ships with Vitest configured but no test files; the dev workflow relies on TypeScript + a11y review (§9).
- **Coverage:** `@vitest/coverage-v8` `^2.1.x`. Threshold enforcement is left to per-feature PRDs.

## 7. Linter + formatter

- **Biome `^1.9.x`** is the single tool for linting AND formatting across all workspaces. Replaces ESLint + Prettier; one config (`biome.json`) at the repo root, one binary, one CI step.
- Rules: `recommended` plus `correctness/noUnusedImports`, `style/useImportType`, `suspicious/noExplicitAny: error`.
- **Boundary enforcement** (architecture §2.3 import rules): handled by a custom `tsx` script `scripts/check-boundaries.ts` that walks the module graph using TypeScript's compiler API and asserts the §2.3 rules. Architecture says "eslint-plugin-boundaries OR equivalent" — the script is the equivalent and keeps the project on a single linter.
- Pre-commit hook (`simple-git-hooks` + `lint-staged`) runs `biome check --write` on staged files.

## 8. Build + bundler

| Workspace | Tool | Output |
|---|---|---|
| `apps/api` | **tsc `5.7.x`** (no bundler) | `dist/` directory of emitted `.js` + `.d.ts`; the docker image starts with `node dist/main.js`. Dev uses **`tsx` `^4.19.x`** for fast reloads. |
| `apps/ui` | **Vite `^7.0.x`** | Static bundle (`dist/`) served by an `nginx:1.27-alpine` container in production-like compose; Vite dev server during local development. |
| `packages/contracts` | **tsc `5.7.x`** | Built once, referenced via the workspace protocol; no bundling needed (it's plain TS source consumed by other workspaces). |

No esbuild config beyond what tsx and Vite ship internally. No Webpack. No Turbopack. No Rollup config (Vite owns it).

## 9. Infra

| Concern | Choice |
|---|---|
| Container runtime | **Docker `27.x`** + **Docker Compose v2** (`docker compose`, the plugin form — not legacy `docker-compose`). Single `docker-compose.yml` at the repo root. |
| Services in compose | `ui` (nginx serving Vite-built static bundle), `api` (Hono on Node 25), `postgres` (postgres:17-alpine with named volume), `api-migrate` (one-shot, depends_on postgres healthy), `seed` (one-shot, depends_on api-migrate completed_successfully). |
| CI provider | **GitHub Actions** — `.github/workflows/ci.yml` running `pnpm install --frozen-lockfile`, `pnpm -r build`, `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test`. Matrix on Node 25 only. |
| Deployment target | Single host (developer laptop or single VM) running `docker compose up`. No Kubernetes, no AWS/GCP/Azure, no Fly/Render/Railway. Brief §10/§13: "Everything required runs inside docker compose." |
| Secrets in dev | `.env` file at repo root (gitignored), `.env.example` documents the required vars (brief §13). |
| Observability backend | `n/a` — structured JSON logs to stdout, brief §13: "no metrics / tracing stack in the PoC". |

## 10. Skill list

The `skill-author` step will produce these `.claude/skills/` packages. Existing process skills (`brain-storming`, `codebase-mapping`, `sprint-planning`, `code-reviewing`, `version-control`, `verification-gates`, `skill-authoring`) are reused as-is and NOT re-authored.

### 10.1 Domain skills (one per chosen tool)

| Skill | Maps to |
|---|---|
| `typescript` | TS 5.7 strict-mode patterns: branded types, discriminated unions, `satisfies`, `noUncheckedIndexedAccess` ergonomics. |
| `pnpm` | Workspace protocol (`workspace:*`), `pnpm -r`, `--filter`, `--frozen-lockfile`, lockfile hygiene. |
| `hono` | Routes, middleware composition, `c.req.parseBody`, error handling, `@hono/node-server` bootstrap. |
| `drizzle` | Schema definition, relations, transactions (`db.transaction`), `drizzle-kit` workflow, prepared statements, soft-delete patterns. |
| `zod` | Zod v4 schemas, `safeParse`, `z.infer`, branded types via `.brand()`, sharing schemas across `apps/api` and `apps/ui` through `packages/contracts`. |
| `react` | React 19 idioms, hooks, suspense, error boundaries, controlled vs uncontrolled forms. |
| `vite` | Config, plugins (`@vitejs/plugin-react`, `@tailwindcss/vite`), dev proxy to `apps/api`, prod build. |
| `tanstack-router` | File-based routing, type-safe params/search, route guards, code-splitting. |
| `tanstack-query` | Query keys, mutations, optimistic updates, integration with the hand-written typed client. |
| `tailwind` | Tailwind v4 config-as-CSS, design tokens via `@theme`, WCAG-AAA-friendly color contrast helpers. |
| `shadcn` | Component scaffolding via the CLI, Radix primitives, accessibility props, dark-mode patterns. |
| `biome` | Config, rule selection, CI vs local invocation, formatter quirks. |
| `vitest` | Config, `vi.mock`, `vi.useFakeTimers`, `--coverage`, file vs project layout. |
| `testcontainers` | `@testcontainers/postgresql` startup/teardown, schema migration helper, parallel-file containers. |
| `docker-compose` | Service definitions, `depends_on: condition: service_healthy`, one-shot services, named volumes, bind mounts. |

### 10.2 Testing-strategy skills (loaded by the `tester` builder persona)

Per the brief's testing posture (§5: API integration + slot-availability unit + document-share authorization unit; §8: NO UI unit/component/e2e tests), three strategy skills are warranted:

| Skill | Scope |
|---|---|
| `unit-testing` | Table-driven unit tests for pure service-layer rules (slot-availability algorithm, document-share authorization). Mocking lifecycle for the repo boundary using `vi.mock` against `repo.ts`. Deterministic time helpers (`vi.setSystemTime`) for slot-window math. ALWAYS included. |
| `api-integration-testing` | Real-Postgres integration tests for every `<resource>.<verb>` RPC. Truncate-and-seed fixture builder, request helpers that wire CSRF + JWT cookies, error-shape assertions against the `AppError` taxonomy (architecture §5.2). Brief §5 demands this for all four use cases. |
| `security-testing` | Authn-bypass smoke (missing/expired/forged JWT), CSRF double-submit failure modes, RBAC role escalation attempts, document-share authorization edge cases, upload validation (MIME spoof, oversize body, path-traversal filename), argon2 timing-safe comparison. Brief §7 + §11's security floor warrants this — the document-share rule is the brief's most security-sensitive line (architecture §5.4). |

`frontend-testing` is intentionally OMITTED — brief §8 explicitly excludes UI unit, component, and end-to-end tests.

`e2e-testing` is intentionally OMITTED — same reason; the closest acceptance signal is the API integration suite plus manual a11y review.

### 10.3 Final `skills_to_author` set

Domain skills (15) + testing-strategy skills (3) = **18 new skills** for `skill-author` to produce.

```
typescript, pnpm, hono, drizzle, zod, react, vite, tanstack-router,
tanstack-query, tailwind, shadcn, biome, vitest, testcontainers,
docker-compose, unit-testing, api-integration-testing, security-testing
```

---

## 11. Open questions closed by this document

- Architecture §6.3 dev-deps (test runner, lint, formatter) → Vitest + Biome.
- Architecture §8 Q3 (refresh-token storage) → server-side `refresh_token` row with rotation on use; `jose` issues the access JWT statelessly.
- Architecture §8 Q4 (CSRF token issuance) → pure double-submit, random 32-byte cookie value generated server-side at login and rotated on refresh; no server-side CSRF state.
- Architecture §8 Q7 (integration-test DB strategy) → testcontainers per test file via `@testcontainers/postgresql`.
- Brief §14 handoff (vitest vs node:test; lint/format; minor-version pins on Hono/Drizzle/TanStack) → all pinned above.

## 12. Open questions deferred

- Architecture §8 Q1 (slot booked-state representation) and Q2 (`appointment.specialization_id` source) — both are schema-shape choices owned by the `scheduling` / `appointments` PRDs, not by tech-stack.
- Architecture §8 Q5 (`packages/contracts` file shape — per-module vs per-RPC-operation) — defer to the first feature PRD.
- Architecture §8 Q6 (doctor visibility into medications/conditions/allergies) — product decision, not tooling.
