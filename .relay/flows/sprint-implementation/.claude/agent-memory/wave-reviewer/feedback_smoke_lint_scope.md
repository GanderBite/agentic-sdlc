---
name: feedback-smoke-lint-scope
description: Smoke wave biome gate must scope to apps/ packages/ (or biome.json must ignore .relay/.planning/.claude) — root-scoped lint hits 55 framework-owned diagnostics.
metadata:
  type: feedback
---

When the smoke wave gates the lint check at the repo root (e.g. `pnpm biome check .`), biome walks `.relay/`, `.planning/`, `.claude/` — these directories contain framework-owned JSON/TS that is NOT formatted by biome and produces dozens of diagnostics. Sprint-001 wave-smoke hit exactly this: scoped `pnpm biome check apps/ packages/` was clean (49 files, 0 errors) while root-scope produced 55 errors entirely outside the codebase under change.

**Why:** The relay tooling tree co-exists in the repo but is not part of the product's lint surface. A naive root-scope smoke gate punishes the sprint for framework hygiene.

**How to apply:**
- When auditing a smoke wave that fails lint at root, immediately re-run scoped to `apps/ packages/` (or whatever the product source roots are). If scoped is clean, file the failure as a `high`-severity config-scope finding, not a code-quality blocking finding.
- Recommend either updating `biome.json` `files.ignore` to include `.relay/`, `.planning/`, `.claude/`, OR changing the build-graph.json smoke lint gate to a scoped command.
- See also [[feedback-ts-extension-imports]] for the parallel TS5097 hygiene issue that recurred in the same wave.
