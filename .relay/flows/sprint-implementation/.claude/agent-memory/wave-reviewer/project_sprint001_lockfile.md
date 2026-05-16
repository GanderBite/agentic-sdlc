---
name: project_sprint001_lockfile
description: Sprint-001 wave-2 regenerated pnpm-lock.yaml for contracts only, leaving apps/api deps unresolved and breaking wave-1's frozen-install gate.
metadata:
  type: project
---

Wave-2 of sprint-001 (api-scaffold-auth) added apps/api/package.json with 16 deps but the builder ran `pnpm install` filtered (or with selective scope) so pnpm-lock.yaml only contains packages/contracts entries.

**Why:** Wave-1 declared `pnpm install --frozen-lockfile` as a build gate and acceptance bullet 1 demands it stays green for the sprint. Wave-2 broke that invariant silently because its own verification block doesn't re-run that gate.

**How to apply:** When a downstream wave adds a new workspace package, verify `pnpm install --frozen-lockfile` still exits 0 at repo root before approving the wave — even if it isn't in the task's verification list. This is a [[feedback_vitest_projects]]-style cross-wave invariant the per-task gates don't catch.
