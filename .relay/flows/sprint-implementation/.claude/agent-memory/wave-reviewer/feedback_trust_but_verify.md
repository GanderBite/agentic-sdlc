---
name: feedback-trust-but-verify
description: Orchestrator's "BUILDER VERIFICATION RESULTS" summary in the reviewer prompt is informational only — re-run every gate authoritatively.
metadata:
  type: feedback
---

The orchestrator's wave-runner can include a "BUILDER VERIFICATION RESULTS" block in the reviewer prompt summarizing what builders reported. Treat this as informational only — re-run every gate authoritatively.

**Why:** in sprint-001 wave-2 the orchestrator claimed "all custom rg gates passed" and "pnpm-lock.yaml (updated — expected)", but `pnpm install --frozen-lockfile` failed because the lockfile lacked the new `apps/api` importer entry, AND `pnpm biome check apps packages` failed because the new `apps/api/tsconfig.json` did not pass the formatter. Builders only run their task-local `verification` block; wave-level gates (install, repo-wide lint) are NOT exercised by builders.

**How to apply:** even when the orchestrator prompt asserts that builder verification passed, always execute the wave-level mechanical gates the user lists in "YOUR JOB". The verification-gates §R4.2 rule applies — reviewer's exit codes are canonical; builder/orchestrator reports are not. Cross-reference: [[project-lockfile-drift-pattern]].
