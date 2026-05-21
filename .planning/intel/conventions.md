# Conventions

Snapshot: `1c1ea6393c49b62e98fdc61a77c743b222a459bc`.

> **Status: FRESH REPO.** Sprint-001 was reset (commit `1c1ea63`) so the hardened workflow can re-execute from scratch. No `apps/`, no `packages/`, no `package.json`, no `biome.json`, no `tsconfig.base.json` on disk yet. Convention facts can only be derived from real files — there is nothing to derive from. This document is therefore a placeholder and must be repopulated once code lands.

## What is preserved

- `pnpm-workspace.yaml` (`packages: [apps/*, packages/*]`) — the workspace topology is committed; the workspace itself is empty.
- `docs/` — the playbook (`AGENTIC_SDLC.md`), product brief (`APPLICATION.md`, `APPLICATION_BRIEF.md`), planned architecture (`ARCHITECTURE.md`), planned tech stack (`TECH_STACK.md`), PRD (`PRD.md`), and the single-page intel summary (`INTEL.md`).
- `.planning/`, `.relay/`, `.claude/` — workflow tooling, agents, skills.

## Planned conventions (NOT yet enforced)

These are taken from `docs/APPLICATION.md` and `docs/TECH_STACK.md` so the upcoming sprint has a target to scaffold against. They are **planned**, not detected from code.

- TypeScript everywhere, strict mode, Zod v4 for validation at every external boundary.
- pnpm workspaces (`apps/*`, `packages/*`); shared contracts package re-exports schemas instead of duplicating them in each app.
- Hono on the API; React + Vite + Tailwind v4 + TanStack Router + TanStack Query + Shadcn UI on the future `apps/ui`.
- PostgreSQL via Drizzle ORM + Drizzle Kit migrations; soft-delete (`deleted_at`) on first-class domain entities.
- Auth: JWT + refresh-token rotation, argon2 password hashes, CSRF double-submit cookie, http-only + secure session cookies, no public sign-up.
- Pino for structured logging with mandatory redaction of cookies, CSRF tokens, and `*.password` paths.
- Vitest for tests; integration tests run against a real Postgres via `@testcontainers/postgresql`. Do not mock the database, password hasher, or JWT signer in integration tests.
- WCAG 2 AAA accessibility target once UI work begins.

## Re-derivation contract

Once scaffolding lands, re-running `relay run intel-refresh` will replace this placeholder with sections derived from the actual on-disk code:

- Naming (filenames, variables, types, schemas, env vars, DB columns, HTTP routes)
- Layering (workspace topology, module structure, public/private boundaries)
- Error handling (`AppError` hierarchy, error envelope)
- Logging (logger configuration, redaction paths)
- Configuration (env loading, cookie presets)
- TypeScript (tsconfig flags, composite project layout)
- Linting / formatting (Biome or alternative)
- Test conventions (cross-link to `test-layout.md`)
- Security invariants and accessibility requirements

Until then, downstream agents (task-builder, wave-runner, wave-reviewer) MUST treat any convention claim that cannot be checked against a real file as a planning assumption, not a derived fact.
