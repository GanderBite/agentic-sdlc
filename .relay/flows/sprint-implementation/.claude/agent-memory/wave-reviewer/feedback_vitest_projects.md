---
name: feedback_vitest_projects
description: Vitest's `test.projects` config key is v3-only; v2 requires a `workspace` field pointing at vitest.workspace.ts.
metadata:
  type: feedback
---

When a vitest.config.ts uses `test: { projects: [...] }`, that is the **Vitest 3** API. In Vitest 2.x the field is silently ignored — multi-project mode is configured via `test.workspace: './vitest.workspace.ts'` or a top-level `vitest.workspace.ts`.

**Why:** A planner can satisfy a substring custom check (`rg integration vitest.config.ts`) while the config is non-functional under the installed runtime. Latent failure surfaces only once integration tests exist.

**How to apply:** Whenever a wave introduces a vitest.config.ts with multi-project intent, cross-check the installed vitest major version in pnpm-lock.yaml against the chosen config API. Flag as `high` (medium at minimum) — substring gates won't catch it. Confirmed in sprint-001 wave-2: apps/api/vitest.config.ts uses test.projects with vitest@2.1.9 resolved; `pnpm exec vitest run` exits 0 with "No test files found" using default include, ignoring the projects array entirely (integration testTimeout 60000 dropped silently).
