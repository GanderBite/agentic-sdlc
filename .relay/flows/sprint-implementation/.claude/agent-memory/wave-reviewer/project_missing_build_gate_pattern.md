---
name: missing-build-gate-pattern
description: Planner consistently omits verification.build for tasks touching non-test source, masking TS compile errors until terminal smoke wave.
metadata:
  type: project
---

Planner-generated tasks in sprint-001 (observed in wave-4 across task-db-setup and task-auth-tokens, suspected earlier in the sprint) carry empty `verification.build` arrays even when `target_files.create` adds new TypeScript source. The verification-gates skill schema explicitly mandates a non-empty `build` array in that case, but the plan validator either accepts the omission or is not invoked at task-edit time.

**Why:** TS compile errors that would surface immediately at task-level (e.g. type drift between imported `./schema.js` and re-exported barrel, mis-typed `Schema` generics, missing `@types/pg`) only show up at the terminal `wave-smoke` task — the exact pattern that caused the wave-smoke 18-error TS5097 surprise per the sprint-001 postmortem (G4 / R10 motivation in verification-gates).

**How to apply:** When reviewing future waves, always cross-check that every task touching non-test source has at least one entry in `verification.build`. If empty, raise as `medium`/`architecture` finding on the plan file (`.planning/sprints/<sprint_id>.tasks.json`) — not on the source files. Cross-link to [[project_recurring_regex_defect]] (also a plan-file class defect surfaced by review-fix-loop without a fixer path).
