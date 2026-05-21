---
name: missing-build-gate-pattern
description: Planner consistently omits verification.build for tasks touching non-test source, masking TS compile errors until terminal smoke wave.
metadata:
  type: project
---

Planner-generated tasks in sprint-001 (observed in wave-4 across task-db-setup and task-auth-tokens, then again in wave-6 across all three tasks: task-auth-repo, task-seed, task-test-support) carry empty `verification.build` arrays even when `target_files.create` adds new TypeScript source. The verification-gates skill schema explicitly mandates a non-empty `build` array in that case, but the plan validator either accepts the omission or is not invoked at task-edit time.

**Why:** TS compile errors that would surface immediately at task-level only show up at the terminal `wave-smoke` task. Concrete wave-6 demonstration: `apps/api/tsconfig.json` has `rootDir: ./src` while `include` matches `test/**/*.ts`; the moment task-test-support populated `apps/api/test/` with the first content, `tsc -p apps/api` started emitting TS6059 on every test file. No wave-6 builder caught this because no task ran a build gate. This is the exact pattern that caused the wave-smoke 18-error TS5097 surprise per the sprint-001 postmortem (G4 / R10 motivation in verification-gates).

**How to apply:** When reviewing future waves, always cross-check that every task touching non-test source has at least one entry in `verification.build`. If empty AND the source change is non-trivial, raise as `high`/`architecture` finding (escalate from medium when impact is concrete and demonstrated by the same wave's source) on the plan file (`.planning/sprints/<sprint_id>.tasks.json`) — not on the source files. Always do a one-shot `tsc --noEmit` on touched packages during review even when not in `verification` — it surfaces latent issues like rootDir/include mismatches that fail only when a particular tree first gets populated. Cross-link to [[project_recurring_regex_defect]] (also a plan-file class defect surfaced by review-fix-loop without a fixer path).
