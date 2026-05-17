---
name: feedback_vitest_projects
description: Vitest@2.1.9 actually does honor `test.projects` (empirically verified); the v2/v3 split is not as clean as docs suggest — empirically validate before flagging.
metadata:
  type: feedback
---

Earlier memory claimed `test.projects` was v3-only and silently ignored by v2. **Empirically falsified in sprint-001 wave-2 re-review (2026-05-17)** on vitest@2.1.9:

- `apps/api/vitest.config.ts` uses `test.projects: [{...unit}, {...integration}]`.
- `pnpm --filter @medbridge/api exec vitest list` discovers BOTH suites (1 unit file with 6 tests + 7 integration files with all expected tests).
- `pnpm --filter @medbridge/api exec vitest run` executes both suites; integration `testTimeout: 60000` is honored (testcontainer tests take ~7s and pass).

**Why:** vitest 2.1.x added experimental forward-compat support for the v3 `projects` API even though docs only mention `workspace` for v2. Treating "projects key" as an automatic v2 misconfiguration is a false positive.

**How to apply:** When you see `test.projects` in a vitest config alongside `vitest@^2`, do NOT flag based on docs alone — run `pnpm exec vitest list` and observe whether both project suites are enumerated. Only flag if discovery actually drops a suite. The v2 `workspace` key is still valid, but `projects` is no longer a guaranteed failure on v2.x.
