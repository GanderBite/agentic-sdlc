---
name: MedBrige project stack
description: Tech-stack snapshot for the MedBrige monorepo as of 2026-05-10
type: project
---

MedBrige is a pnpm-workspaces monorepo with three workspace surfaces:
- `apps/api` — Hono server, Drizzle ORM, Postgres 16, NodeNext modules
- `apps/ui` — React + Vite 7 bundler, Bundler module resolution
- `packages/shared` — TS-only library consumed by both apps via `workspace:*` and `@medbrige/shared` package name; emits to `dist/` via `tsc`

Stack pins (from `docs/TECH_STACK.md`):
- TypeScript 5.7 with `strict: true` everywhere, plus extra correctness flags (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, etc.)
- pnpm 10 with workspaces; `apps/*` and `packages/*` patterns
- API dev: `tsx@4` (no type-check); API prod: `tsc` to `dist/` then `node`
- UI: Vite 7 owns bundling; `tsc -b apps/ui` is type-check-only (`noEmit: true`)
- Vitest 3 for tests, Biome 2 for lint+format (replaces ESLint+Prettier)
- Project references via root solution `tsconfig.json`; `tsc -b` orchestrates the build graph

**Why this matters for skill-authoring:** Skills targeting this repo should expect three workspaces, not one app; should differentiate Node-leaf vs UI-leaf conventions; should reference `pnpm`, `tsx`, `vite`, `tsc -b`, and Biome (not ESLint/Prettier) in their build/dev rules.

**How to apply:** When authoring framework or tool skills (hono, drizzle, react, vite, vitest, biome, etc.), assume the host monorepo layout above. Cross-reference `pnpm-workspaces` and `typescript` skills rather than re-stating workspace mechanics or tsconfig rules.
