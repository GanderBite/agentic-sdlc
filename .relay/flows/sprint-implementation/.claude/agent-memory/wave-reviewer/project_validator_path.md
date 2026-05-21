---
name: project-validator-path
description: scripts/validate-review.mjs path in the prompt is stale; real path is under .relay/flows/sprint-implementation/scripts/
metadata:
  type: project
---

The wave-reviewer agent prompt asks you to run `node scripts/validate-review.mjs ...` from the repo root, but the script does NOT live at the repo root.

**Why:** The repo's only top-level `scripts/` directory contains `_lib.sh` and `validate-plan.mjs` — no `validate-review.mjs`. The validator actually lives at `.relay/flows/sprint-implementation/scripts/validate-review.mjs`. The prompt template was written for a different layout.

**How to apply:** Run the validator from its real path: `node .relay/flows/sprint-implementation/scripts/validate-review.mjs <review.json> <findings.json>`. Pass BOTH files in one invocation — the validator checks both schemas in a single run. The prompt's single-arg form (`findings-wave-1.json`) is supported only if the matching `review-…json` lives next to it (the validator auto-derives the path).

Related: [[project-lockfile-drift-pattern]].
