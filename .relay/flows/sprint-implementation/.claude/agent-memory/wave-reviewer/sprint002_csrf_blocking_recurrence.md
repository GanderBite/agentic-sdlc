---
name: sprint002-csrf-blocking-recurrence
description: The csrf EXEMPT_PATHS /v1/auth/* vs /api/* mismatch was flagged blocking+auto_fixable in wave-5 and still ships in wave-10; the review-fix-loop's fixer dispatch never converged on this defect across five waves.
metadata:
  type: project
---

The csrf.ts EXEMPT_PATHS finding (paths /v1/auth/login + /v1/auth/refresh, but app.ts mounts at /api) was first emitted as `[blocking][auto_fixable=true]` at wave-5 (line 11 of `.planning/reviews/sprint-002/do-not-recur.md`). It then persisted unfixed through waves 6, 7, 8, 9 and was re-surfaced again as the gating defect in wave-10.

**Why:** the fixer dispatch step of the review-fix-loop is supposed to spawn a file-scoped Task for every `auto_fixable: true` finding. For this defect, either (a) the fixer was dispatched and silently failed (the Edit returned but didn't actually update the file), or (b) the do-not-recur.md ledger is consulted by planners but the fixer-dispatcher reads only the latest `findings-{wave}.json`. Builders skip the existing diagnostic because the task description doesn't reference the prod-source fix.

**How to apply:** when the SAME `auto_fixable: true` finding appears in two consecutive waves, escalate via R7.3 (set meta.escalated:true) AND treat the cross-wave recurrence as evidence the fixer/protocol pair is broken — not as noise. Surface that the project bug is in the fixer dispatcher, not in the test code authoring the recurring finding. See [[sprint002_auth_route_prefix]] for the sibling /api/auth.* prefix recurrence that compounds this one.
