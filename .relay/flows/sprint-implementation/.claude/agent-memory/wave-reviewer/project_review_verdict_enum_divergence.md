---
name: review-verdict-enum-divergence
description: review.verdict enum disagreement between code-reviewing skill spec and the validate-review.mjs script — always use the validator's enum
metadata:
  type: project
---

review.verdict enum: the **code-reviewing skill SKILL.md** (R8 / §10.1) lists `pass | fail | reviewer_overload`. The **validator** (`.relay/flows/sprint-implementation/scripts/validate-review.mjs` line 54) accepts `['pass','blocked','failed','partial','reviewer_overload']` and REJECTS `fail`.

**Why:** validator is downstream and authoritative for the orchestrator pipeline — `code-reviewing/SKILL.md` and the wave-reviewer agent prompt both lag behind the canonical enum the wave-runner reads. Surfaced during sprint-001 wave-9 (Phase 1 failed with a pre-existing build gate; writing `verdict: "fail"` made the validator emit `review_verdict_invalid`).

**How to apply:** when writing `review-{wave_id}.json`, always use `failed` (past-tense) for build-gate-or-test-gate failures. Reserve `blocked` for tasks that cannot start (missing dep), `partial` for mixed-task waves, `reviewer_overload` for >5 blocking. Per-task `verdict` still uses `['pass','fail','partial']` — the difference is only at the top-level. See [[project_validator_path]] for the script location.
