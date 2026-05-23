---
name: sprint002-aggregate-gate-failures
description: Sprint-002 closed with lint, typecheck, and unit-test gates ALL failing on HEAD; per-wave reviewers passed them by running over per-task scoped subsets. Aggregate review surfaced these only by re-running the gates repo-wide.
metadata:
  type: project
---

Sprint-002 (api-scaffold-auth) shipped 10 waves + smoke at sha 1d28d76; aggregate review-iter-1 found `pnpm -w lint` fails on biome config schema errors, `pnpm -w typecheck` fails on TS5110 (module=ESNext vs moduleResolution=NodeNext), and `pnpm --filter @medbridge/api test` fails with "no tests found" because vitest.config.ts only globs `src/**/*.test.ts` (integration tests live under `test/integration/` behind a separate `:integration` script). 15 of 31 integration tests also fail (csrf path mismatch + missing clockTolerance).

**Why:** Per-wave gates ran against scoped command (e.g. `pnpm --filter @medbridge/api typecheck` against a partial file set, or the wave's verification.tests against a recent file). Wave-1 reviewer flagged TS5110 with `auto_fixable: true` but the fixer dispatcher never repaired it. Wave-5 / wave-7 / wave-10 all flagged the csrf+route prefix mismatch with `auto_fixable: true`; none of the fixes landed. Multiple `auto_fixable` recurrences across waves is exactly the §R7.3 escalation pattern — the fixer is silently failing OR the reviewer is mismarking judgmental work as auto-fixable.

**How to apply:** Before declaring an aggregate sprint review "pass," re-run the THREE root scripts (`pnpm -w lint`, `pnpm -w typecheck`, default unit test script for every workspace package) against HEAD. Per-wave gates lie about repo-wide health when the scope is too narrow. Also: the `do-not-recur.md` ledger shows the SAME `auto_fixable=true` finding recurring across 5+ waves is a project bug — the fixer-dispatch step is not actually running, or the planner is mismarking. Flag `meta.escalated: true` on third recurrence per §R7.3.
