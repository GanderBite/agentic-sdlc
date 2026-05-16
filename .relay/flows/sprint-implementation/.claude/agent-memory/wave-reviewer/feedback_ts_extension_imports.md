---
name: feedback-ts-extension-imports
description: Builders sometimes write relative imports with .ts extensions instead of .js, which breaks tsc -b under NodeNext+verbatimModuleSyntax (TS5097). Lint passes silently.
metadata:
  type: feedback
---

Builders in this project (sprint-001) have written `from './foo.ts'` instead of `from './foo.js'`. Biome does not flag this; `pnpm biome check` (the only gate in many tasks' verification) passes green. But `tsc -b` fails with TS5097 because `apps/api/tsconfig.json` extends `tsconfig.base.json` which sets `module: NodeNext` + `verbatimModuleSyntax: true` and does NOT set `allowImportingTsExtensions`.

**Why:** Project convention (set by `apps/api/src/shared/logger.ts` in wave-3 and `apps/api/src/modules/auth/tokens.ts` in wave-4) is `.js` extensions on relative imports. Anything else breaks the build.

**How to apply:**
- When auditing any wave that adds a new `.ts` file under `apps/api/src/`, grep its relative imports for `\\.ts['"]$` and flag as `blocking` (build broken).
- If the wave's `verification.build` is empty or non-existent, this issue won't be caught by Phase 1 gates — Phase 2 audit must catch it.
- See sprint-001 wave-4 F-001 (apps/api/src/db/client.ts lines 5-6) for the canonical instance.

Cross-ref: [[project-sprint001-env-eager-load]] (another class of issue not caught by lint-only gates).
