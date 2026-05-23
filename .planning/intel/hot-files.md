# Hot files (files touched in >10% of last 200 commits)

Snapshot: `1c8d5d1707e5aa47d37c987e847cd6ae0fcc2a41`.

## Result: no files exceed the >10% threshold

The repo currently has 144 commits total (`git log --pretty=format:%H | wc -l`).
10% of the lookback window is ~14 commits. The most-touched product files only
reach 6 commits each, which is well below the threshold.

## Top product-code files in the last 200 commits (for context)

```
6  apps/api/src/seed/main.ts
6  apps/api/src/modules/auth/service.ts
6  apps/api/src/modules/auth/schema.ts
6  apps/api/src/middleware/csrf.ts
6  apps/api/src/db/schema.ts
5  packages/contracts/src/index.ts
5  apps/api/vitest.config.ts
5  apps/api/test/support/passwords.ts
5  apps/api/test/support/logCapture.ts
5  apps/api/src/shared/logger.ts
5  apps/api/src/modules/auth/routes.ts
5  apps/api/src/modules/auth/repo.ts
5  apps/api/src/middleware/authn.ts
5  apps/api/src/main.ts
4  packages/contracts/src/auth.ts
4  apps/api/tsconfig.json
4  apps/api/test/support/request.ts
4  apps/api/test/support/fixtures.ts
4  apps/api/test/integration/auth.refresh.test.ts
4  apps/api/test/integration/auth.login.test.ts
4  apps/api/src/shared/ids.ts
4  apps/api/src/shared/errors.ts
4  apps/api/src/modules/auth/index.ts
4  apps/api/src/middleware/requestId.ts
4  apps/api/src/middleware/logger.ts
4  apps/api/src/middleware/errorHandler.ts
4  apps/api/src/middleware/authz.ts
```

## Source query (for reproducibility)

```sh
git log --pretty=format: --name-only -200 \
  | grep -E '^(apps|packages|docs)/' \
  | sort | uniq -c | sort -rn | head -30
```

## Planner guidance

- Sprint-002 (`api-scaffold-auth`) just landed, so churn is concentrated in
  files that were edited across the wave-N + review-iter commits. None of
  these reflect long-term hotspots yet.
- Treat all auth-module files (`apps/api/src/modules/auth/**`) and the
  middleware chain as "warm" — they were touched multiple times during the
  review iterations and are likely to see follow-up work for the F-202,
  F-205, F-208 items noted in `conventions.md`.
- Re-run `relay run intel-refresh` after another sprint or two; once the
  lookback window contains real maintenance churn the leaderboard becomes
  meaningful.
