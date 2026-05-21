---
name: project-lockfile-drift-pattern
description: Workspace-scaffold waves frequently land new package manifests without regenerating the lockfile, so the very next wave's frozen-install gate fails as a blocking finding.
metadata:
  type: project
---

When a wave creates a new workspace package (adds a `package.json` under `apps/*` or `packages/*`), builders often update only the manifest and skip regenerating the lockfile. The next wave's `pnpm install --frozen-lockfile` (or equivalent) gate then fails with ERR_PNPM_OUTDATED_LOCKFILE because the lockfile's `importers` section has no entry for the new package.

**Why:** the task-builder's per-task verification block typically only runs `tsc -b` and `rg` symbol checks — it does NOT exercise the workspace-wide install path. The drift is invisible until a downstream wave or the smoke wave runs the install command.

**How to apply:** when reviewing any wave that adds a new `package.json` under a workspace-glob path, ALWAYS run `pnpm install --frozen-lockfile` as a wave-level mechanical gate even if it is not in `task.verification`. The drift is an auto_fixable blocking finding — the fix is `pnpm install` (without `--frozen-lockfile`) and re-stage the lockfile. Recurrence across iterations means the fixer dispatch is dropping the lockfile re-stage step; escalate to `meta.escalated: true` on the second occurrence per verification-gates §R7.3.
