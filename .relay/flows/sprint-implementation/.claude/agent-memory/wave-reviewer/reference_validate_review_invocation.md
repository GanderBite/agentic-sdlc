---
name: validate-review-invocation-quirk
description: scripts/validate-review.mjs interprets argv[0] as the review-{wave}.json path; passing only findings-* makes it treat that file as the review file and fail with review_verdict_invalid.
metadata:
  type: reference
---

`node scripts/validate-review.mjs <review.json> [<findings.json>]` — argv[0] is the review path. If you pass `findings-waveN.json` alone, the script tries to parse it as the review file (no `verdict`/`tasks` keys → blocking errors). Correct invocation:

```
node scripts/validate-review.mjs .planning/reviews/review-wave-N.json .planning/reviews/findings-wave-N.json
```

**Why:** The CLI doc-comment is unambiguous but the orchestrator prompt sometimes asks for findings-only invocation — that always fails. Always pass both paths.

**How to apply:** When the user instruction says "validate the findings file", run with both paths anyway and surface the discrepancy in notes. Single-arg invocation fails even on well-formed outputs.
