# Hot files (top files touched in last 200 commits)

> **Fresh repo.** No application code has been committed yet — the only commit history belongs to the SDLC tooling under `.relay/` and `.claude/`, not to the MedBridge product. Reporting those as "hot" would mislead reviewers, so this file is intentionally a placeholder.

Re-run `relay run intel-refresh` after the first product code lands to populate real hot-files data via:

```
git log --pretty=format: --name-only -200 | sort | uniq -c | sort -rn | head -50
```

## Current state

- Product files touched in last 200 commits: **0**
- Tooling/meta files (excluded from hot-files): `.relay/**`, `.claude/**`, `docs/**`, `scripts/**`

When this list does get populated, treat any file appearing in >10% of recent commits as a stability hot-spot — extra review weight in `wave-reviewer`, candidate for refactor in subsequent sprints.
