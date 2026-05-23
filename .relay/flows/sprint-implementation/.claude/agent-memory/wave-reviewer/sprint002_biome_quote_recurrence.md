---
name: sprint002-biome-quote-recurrence
description: TS-builder skill never ran biome format --write throughout sprint-002 implementation; finally repaired by iter-2 fix commit via repo-wide format pass.
metadata:
  type: project
---

**Status as of review-iter-2 (HEAD 97a66c1):** RESOLVED for sprint-002. The iter-2 fix commit ran `pnpm format` (biome format --write) repo-wide as part of the 72-file reformatting sweep. `pnpm -w lint` now exits 0.

**History:** Every wave 2-10 AND the iter-1 fix commit shipped TS sources with double quotes despite biome quoteStyle=single. The recurrence pattern was a [low] finding on each wave, marked auto_fixable=true. Even the dedicated review-iter-1 fix iteration (commit a86fa66) did NOT clear it — because the fixer Task itself did not run biome format. Only when the implementer manually ran format in iter-2 did the lint pass.

**Why:** Per `verification-gates §R6`, each tool skill is supposed to ship a `## Builder protocol` section that mutates target files into a canonical state pre-verification. The TS-builder skill either lacks a biome-format step or it does not target the right paths.

**How to apply:** Going into sprint-003+, this pattern will RE-EMERGE on the first TS-creating wave unless the TS-builder skill is updated. Expect double-quote drift on every wave that creates `.ts`/`.tsx`. Emit ONE consolidated finding (don't spam per-file) and ESCALATE to `blocking` per R7.3 on the second+ recurrence. Suggested_fix is always `pnpm format`. Flag in the sprint retro that the typescript-builder skill's Builder protocol section needs auditing AND the review-fix-loop fixer prompt needs an explicit "after edits, run formatter" step.
