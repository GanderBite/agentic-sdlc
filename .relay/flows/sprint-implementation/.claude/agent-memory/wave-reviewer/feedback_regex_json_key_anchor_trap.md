---
name: regex-json-key-anchor-trap
description: Planner-emitted `custom` regex gates anchored with `^` against JSON keys are unsatisfiable because JSON keys are quoted+indented; classify as plan-defect, not code defect.
metadata:
  type: feedback
---

When a `task.verification.custom` regex of the form `^<key>":\s*"<value>` is used against a JSON file, it CANNOT match — JSON keys are always `"<key>"` (quoted) and typically indented. The leading `^` plus missing opening `"` makes the gate unsatisfiable regardless of file content.

**Why:** Observed in sprint-001 wave-1 task-workspace-root custom[0]: `rg --quiet "^packageManager\":\s*\"pnpm@10" package.json` against valid `  "packageManager": "pnpm@10.33.0"`. Builder correctly returned `partial` and routed to `.planning/blocked/sprint-001/task-workspace-root.md`. Code was spec-correct; only the planner regex was wrong.

**How to apply:** When auditing a wave where a single `custom` regex gate fails alongside otherwise green build/files_exist/other-custom gates, before flagging code as broken, sanity-check the regex against the actual file line. If the regex can never match valid JSON (e.g. anchored `^` immediately followed by an unquoted key), emit a `low`/`architecture` finding labelled "plan-defect" and set top-level review verdict to `partial` (not `failed`) — orchestrator routes plan defects to plan repair, not code retry. The fix lives in `.planning/sprints/<sprint>.tasks.json`, never in source.

Correct rewrite pattern: `rg --quiet '"<key>"\\s*:\\s*"<value>' <file.json>` — drops the `^` anchor and restores the opening quote. Related: [[review-verdict-enums]] for verdict enum choice; [[validate-review-invocation-quirk]] for validator usage.
