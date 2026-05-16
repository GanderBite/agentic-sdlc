---
name: review-verdict-enum-mismatch
description: review-{wave_id}.json top-level verdict and task-level verdict use different enums per validator.
metadata:
  type: feedback
---

In `review-{wave_id}.json` the top-level `verdict` field is validated against the §22 wave-runner enum: `pass | blocked | failed | partial | reviewer_overload`. The per-task `tasks[].verdict` uses §10.1's reviewer enum: `pass | fail | partial`. So a failing wave is `"verdict": "failed"` at top-level but `"verdict": "fail"` at task-level.

**Why:** `scripts/validate-review.mjs` lines 54 + 65 split the two enums explicitly. The `code-reviewing` skill text uses `pass | fail | reviewer_overload` for top-level but the validator (authoritative gate) overrides this. Confirmed in sprint-001 wave-1 and wave-9 reviews.

**How to apply:** When emitting a failure top-level verdict in `review-{wave_id}.json`, use `"failed"` not `"fail"`. Task-level keeps `"fail"`. If unsure, grep `.planning/reviews/**/review-*.json` for prior conventions.
