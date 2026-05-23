---
name: sprint002-biome-quote-recurrence
description: Every wave AND the iter-1 fix commit in sprint-002 has shipped TS sources with double quotes despite biome quoteStyle=single; review-iter-2 confirms 104 lint errors persisted after the dedicated fix iteration.
metadata:
  type: project
---

In sprint-002 the typescript-builder skill's builder protocol is NOT running `biome format --write` on TARGET_FILES before returning. This produces a recurring `[low]` (escalated to `[high]` since wave-4, and to `[blocking]` in review-iter-2 per verification-gates R7.3) finding tagged `auto_fixable: true` on every wave that creates TS sources.

**Why:** Per `verification-gates §R6`, each tool skill is supposed to ship a `## Builder protocol` section that mutates target files into a canonical state pre-verification. The TS skill either lacks a biome-format step or it is failing to fire on the actual TARGET_FILES paths. **Crucially, this also held during review-iter-1's fix dispatch**: F-024 was marked `auto_fixable: true` AND the fix iteration produced commit a86fa66 — yet `pnpm -w lint` still exits 1 with 104 errors at HEAD. The fixer Task itself is not running `biome format --write` after applying edits.

**How to apply:** On any wave that creates `.ts`/`.tsx` files in sprint-002 (or successors using the same skill), expect double-quote drift; emit ONE consolidated finding (don't spam per-file). If this is the second+ occurrence with auto_fixable=true, ESCALATE to `blocking` per R7.3. Suggested_fix should always be the single command `pnpm format` (root-level `biome format --write .`), and the retro should flag BOTH the typescript-builder skill AND the review-fix-loop's fixer dispatcher prompt as needing a mandatory format pass.
