---
name: aggregate-review-scope
description: For aggregate (post-sprint) reviews, always re-run the three root gates repo-wide (pnpm -w lint, pnpm -w typecheck, default unit test script per package) before trusting per-wave verdicts.
metadata:
  type: feedback
---

When asked to do an aggregate review across an entire sprint (vs a single wave), I MUST re-run `pnpm -w lint`, `pnpm -w typecheck`, and `pnpm --filter <pkg> test` from the repo root regardless of what per-wave `review-wave-*.json` files claim. Per-wave gates use scoped command variants (e.g. `--filter @medbridge/api`) against partial file sets at the time the wave shipped; the green sums lie about the HEAD state once subsequent waves edit shared files (tsconfig.base.json, biome.json, vitest.config.ts).

**Why:** Sprint-002 closed with all three root gates failing on HEAD even though waves 1-10 each reported `verdict: "pass"`. Wave-1 reviewer flagged the TS5110 module mismatch with auto_fixable=true; the fixer never ran; subsequent waves' typechecks passed locally only because they used `tsc --noEmit -p tsconfig.json` from a different wd or with the wave's partial file set. Same for biome.json (config schema rot) and the unit-test script (its include glob is stale).

**How to apply:** In any aggregate / post-sprint reviewer prompt, my first three Bash calls are the three root scripts. If any exits non-zero, that's at least one blocking finding regardless of what waves reported. Per-wave reviewers were not lying — they were checking a smaller universe.
