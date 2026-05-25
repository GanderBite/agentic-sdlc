---
name: sprint003-lint-gate-recurrence
description: sprint-003 lint gate fails across all iterations due to biome format (vite.config.ts) and organizeImports (LoginForm.tsx) — fixer not running pnpm format
metadata:
  type: project
---

The `pnpm -w lint` gate has failed in sprint-003 across gate-replay-iter-1 and review-iter-2. Root causes:
1. `apps/ui/vite.config.ts` line 8: plugins array on one line exceeds biome lineWidth=100 — needs `biome format --write`
2. `apps/ui/src/features/login/LoginForm.tsx` line 1: import order does not match biome organizeImports — needs `biome check --write`

**Why:** The typescript-builder skill's Builder protocol does not appear to run `pnpm format` or `biome check --write` before verification gates. This is the same root cause as sprint-002's biome quote-style recurrence ([[sprint002_biome_quote_recurrence]]).

**How to apply:** When reviewing sprint-003+ fixes, verify the fixer runs `pnpm exec biome check --write` on changed files. If the format/organize finding recurs at iter-3, this confirms a systemic Builder protocol gap.
