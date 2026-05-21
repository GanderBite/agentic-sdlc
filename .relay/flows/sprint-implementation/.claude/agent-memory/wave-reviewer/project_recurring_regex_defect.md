---
name: project-recurring-regex-defect
description: task-workspace-root's verification.custom[0] regex has been broken across multiple sprint-001 runs; review-fix-loop has failed to patch it
metadata:
  type: project
---

Sprint-001's `task-workspace-root.verification.custom[0]` carries a regex defect that has survived at least one fixer iteration:

```
rg --quiet "^packageManager\":\s*\"pnpm@10" package.json
```

The pattern anchors `packageManager` to start-of-line without a leading whitespace/quote, but JSON formatting always emits `  "packageManager": "pnpm@10.x"` with leading whitespace + opening quote. The pattern cannot match valid JSON.

**Why it keeps recurring:** The fixer dispatched by `review-fix-loop` for an `auto_fixable: true` finding scoped to source code under `apps/`/`packages/` does not have authority (or the right scope) to patch the planner's task spec at `.planning/sprints/sprint-001.tasks.json`. The skill's Builder protocol fixes code, not plan files.

**How to apply:** When you see this pattern recur on a wave-1 review, escalate severity from `medium` to `blocking` per R7.3. Suggested fix: replace the pattern with `^\s*\"packageManager\":\s*\"pnpm@10`. The substantive value in `package.json` line 4 (`pnpm@10.11.0`) is correct — this is a planner-spec defect only.

Related: [[project-validator-path]].
