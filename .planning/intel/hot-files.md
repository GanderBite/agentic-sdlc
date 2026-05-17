# Hot files (top files touched in last 200 commits)

Snapshot: `698a63298ece745c06d57a56a863284313daa83f`.
History depth: **63 commits** total in this repo (less than 200). Threshold for "hot" (>10% of the window) therefore lands at **>6 commits**.

Source query:

```sh
git log --pretty=format: --name-only -200 \
  | grep -E '^(apps|packages|docs)/' \
  | sort | uniq -c | sort -rn | head -30
```

## Result: no product files cross the 10% threshold yet

The repo is one sprint old; product code only landed in the last ~30 commits. Reviewers should treat the table below as the leaderboard of files most likely to churn next, not as confirmed stability hot-spots.

| Commits | File |
|---:|---|
| 3 | `apps/api/src/modules/auth/schema.ts` |
| 3 | `apps/api/src/db/schema.ts` |
| 2 | `packages/contracts/src/index.ts` |
| 2 | `docs/APPLICATION.md` |
| 2 | `apps/api/vitest.config.ts` |
| 2 | `apps/api/test/support/db.ts` |
| 2 | `apps/api/test/integration/auth.log-scrub.test.ts` |
| 2 | `apps/api/src/shared/logger.ts` |
| 2 | `apps/api/src/shared/env.ts` |
| 2 | `apps/api/src/seed/main.ts` |
| 2 | `apps/api/src/modules/auth/service.ts` |
| 2 | `apps/api/src/modules/auth/service.test.ts` |
| 2 | `apps/api/src/modules/auth/repo.ts` |
| 2 | `apps/api/src/main.ts` |
| 2 | `apps/api/src/db/client.ts` |

## Planner guidance

- Until the history reaches a meaningful 200-commit window, `wave-reviewer` should give extra weight to **any** change in `apps/api/src/modules/auth/**` and `apps/api/src/db/**` — those are the load-bearing files of the only landed module, and the schema/auth-service pair has churned the most so far.
- Re-run `relay run intel-refresh` after every sprint; once the window crosses ~200 commits, the actual "hot-spot" cohort will start to stabilise and the leaderboard above will be replaced with a true >10% list.
