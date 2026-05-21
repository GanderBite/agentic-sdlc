---
name: project-review-iter-carries-unhealed-blockers
description: Aggregate review-iter-N at the end of a blocked sprint reliably re-surfaces blocking findings the wave-loop reviewer already flagged but the fixer-dispatch step failed to heal
metadata:
  type: project
---

When sprint-001 hit the terminal `wave-smoke` gate with `blocked` verdict, every wave-level finding marked `auto_fixable: true` was carried forward to the post-wave `review-fix-loop` because the wave-loop fixer-dispatch was disabled or wired only for `severity == blocking` (R7.2 contract gap). The aggregate review at iteration 1 of `review-fix-loop` therefore re-emits the same defects as new findings (auth.me contract leakage, tsconfig rootDir drift, stale artifact pollution, biome ignore omissions).

**Why:** the wave-reviewer's `auto_fixable: true` is a promise that the fixer can heal in one shot — when the wave-loop ends with several such findings still in tree, the post-wave review must NOT downgrade them, must escalate per R7.3 if they recur across the boundary, and must propose a single coordinated fix commit (split tsconfig + purge artifacts + extend ignores) because the four blockers share one root cause (tsconfig emits into test/, .gitignore does not cover it, biome lints it).

**How to apply:**
- On the first review-iter-N invocation, read every `findings-wave-*.json` and `findings-wave-smoke.json` in the sprint's state directory. Any finding with `auto_fixable: true` that still observable in HEAD is a recurrence signal — annotate with `meta.carried_from` and bump severity to `blocking` per R7.3 if the prior wave also marked `auto_fixable: true`.
- Prefer producing fewer high-leverage findings than re-stating every wave-level finding. The do-not-recur.md digest is the carrier of historical noise; the new findings file should focus on patterns that survived the wave-loop.
- Always re-verify route handlers against contract schemas in Phase 2 — the wave-8 pattern (handler returns DB row directly without .parse()) recurred verbatim at auth.me in routes.ts line 133 because the prior fix landed only on login/refresh.
