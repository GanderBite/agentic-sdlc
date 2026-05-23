---
name: sprint002-biome-quote-recurrence
description: Every wave in sprint-002 has shipped TS sources with double quotes despite biome quoteStyle=single; pattern recurs in waves 2, 4, and 5.
metadata:
  type: project
---

In sprint-002 the typescript-builder skill's builder protocol is NOT running `biome format --write` on TARGET_FILES before returning. This produces a recurring `[low]` (escalated to `[high]` since wave-4) finding tagged `auto_fixable: true` on every wave that creates TS sources.

**Why:** Per `verification-gates §R6`, each tool skill is supposed to ship a `## Builder protocol` section that mutates target files into a canonical state pre-verification. The TS skill either lacks a biome-format step or it is failing to fire on the actual TARGET_FILES paths.

**How to apply:** On any wave that creates `.ts`/`.tsx` files in sprint-002 (or successors using the same skill), expect double-quote drift; emit ONE consolidated `[high]` finding (don't spam per-file). Flag the typescript skill's Builder protocol as the root cause in the suggested_fix.
