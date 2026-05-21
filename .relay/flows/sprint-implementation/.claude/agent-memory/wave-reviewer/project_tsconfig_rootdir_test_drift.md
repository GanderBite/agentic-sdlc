---
name: project-tsconfig-rootdir-test-drift
description: tsconfig.json declares rootDir under src/ while include matches test/**/*.ts — recurring defect across sprint-001 (wave-6 first; wave-smoke terminal). TS6059 aborts typecheck and build for every test file.
metadata:
  type: project
---

`apps/api/tsconfig.json` declares `rootDir: "./src"` AND `include: ["src/**/*.ts", "test/**/*.ts"]`. These settings contradict each other: TS6059 fires for every file under `test/` when `tsc -b` runs. Symptom cascade:

1. `pnpm -r typecheck` / `pnpm -r build` abort with N copies of TS6059 (one per integration test file).
2. Before the abort, `tsc -b` partially emits `.js` and `.d.ts` siblings into `test/integration/` and `test/support/` (because `composite: true` + no separate build config).
3. Stale emit artifacts pollute biome lint (`pnpm biome check .` discovers them, complains about formatting / unused imports), and vitest's default `**/*.test.{js,ts}` glob discovers BOTH the source `.ts` and emitted `.js` copies — the `.js` copies fail module resolution because they reference `../../src/...js` paths that source has never emitted.

**Why:** Wave-6 introduced the test tree but did not split the tsconfig. This recurred as a [[project-missing-build-gate-pattern]] near-cousin: no wave actually compiled the workspace until terminal smoke. Loaded into the digest as a `blocking` finding at wave-6 with `auto_fixable=false`.

**How to apply:** When reviewing any TS workspace with `composite: true` + `rootDir`: cross-check that `include` does NOT extend beyond `rootDir`. The fix shape is invariant — split into `tsconfig.build.json` (emit, rootDir-bound) and `tsconfig.json` (IDE/typecheck, no rootDir). Also verify `.gitignore` covers `**/*.tsbuildinfo`, `apps/*/test/**/*.{js,d.ts}` so emit accidents do not slip into PRs. Related: [[project-lockfile-drift-pattern]] for the family of "wave introduces config that breaks at next gate" defects.
