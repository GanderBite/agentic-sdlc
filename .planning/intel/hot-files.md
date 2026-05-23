# Hot files (top files touched in last 200 commits)

Snapshot: `e8740f615565b92f5218e9e6b5858d8a026e5ded`.

> **Status: FRESH REPO.** Sprint-001 was reset on commit `1c1ea63`; commits up through `e8740f6` only touch `.relay/flows/**`, `.planning/**`, scripts, and root markdown — no product code has been re-added. Only docs, planning artefacts, workflow tooling, and `pnpm-workspace.yaml` exist on disk. There are no `apps/` or `packages/` files to count against the >10% threshold.

## Result: n/a

`hot-files` measures *product* code churn (`apps/**`, `packages/**`). With those directories empty, the leaderboard is empty by construction — listing churn against deleted files would mislead reviewers.

Source query (kept for documentation; produces nothing useful right now):

```sh
git log --pretty=format: --name-only -200 \
  | grep -E '^(apps|packages|docs)/' \
  | sort | uniq -c | sort -rn | head -30
```

## Planner guidance

- Treat all freshly-scaffolded modules in the next sprint as "warm by default" — there is no churn history to lean on.
- Re-run `relay run intel-refresh` after the first sprint that lands code; once the window has real product commits the leaderboard will start to mean something again.
