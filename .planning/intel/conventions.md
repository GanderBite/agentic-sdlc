# Conventions

> **Fresh repo.** No source code yet, so nothing has been *observed*. The sections below seed planned conventions derived from `docs/APPLICATION.md`. The `tech-stack` and first scaffolding sprint should update this file once real code lands, and `intel-refresh` will rewrite it from disk.

## Naming
- TBD by tech-stack step. Suggested default for TypeScript: `kebab-case` for filenames, `PascalCase` for React components, `camelCase` for variables, `SCREAMING_SNAKE_CASE` for env vars and exported constants.
- Database tables: `snake_case` plural (Drizzle convention).
- Route segments: `kebab-case`.

## Layering
- Monorepo via pnpm workspaces with two apps:
  - `apps/api` — Hono server, Drizzle ORM, business logic.
  - `apps/ui` — React + Vite SPA.
- Suggested API layering: `routes/ → services/ → repos/ → db/`. UI: `routes/ → features/ → components/ → hooks/`.
- Shared types/schemas (Zod v4) may live in `packages/shared` if cross-app reuse appears; do not pre-create until needed.

## Error handling
- Validate every external input with Zod v4 at the boundary (HTTP handlers, form submits).
- API errors should be typed `{ code, message, details? }`; never leak stack traces in production responses.
- Use `Result`-style returns or thrown domain errors consistently inside the API — pick one in the first sprint and document here.

## Logging
- Structured logging (JSON) on the API; never log PHI or document contents.
- UI: console only in dev; production logs go through an error boundary + a typed reporter (TBD).

## Public/private boundaries
- Only export from each module's `index.ts` (barrel) what other modules need. Anything not re-exported is internal.
- Cross-app imports must go through `packages/*` once those exist; `apps/ui` must never import from `apps/api` directly.

## Test conventions
- Backend (`apps/api`) only — UI tests are explicitly out of PoC scope (see APPLICATION.md trade-offs).
- Unit tests colocated as `*.test.ts` next to source; integration tests under `apps/api/tests/integration/**`.
- Use a real Postgres (Docker Compose) for integration tests; do not mock the DB.
- Fixtures live in `apps/api/tests/fixtures/` (seed data for doctors/patients/slots).

## Linting / Formatting
- None configured yet — `package.json` does not exist. The tech-stack step must pick an enforcement story (e.g. ESLint + Prettier, Biome) and document it here.

## Accessibility
- WCAG 2 AAA is a product requirement, not a nice-to-have. Treat any non-AAA color contrast, focus, or keyboard regression as a release blocker.
