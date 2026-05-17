---
name: aggregate-review-empty-tasks
description: For aggregate post-sprint reviews (Phase 2 only), `tasks: []` is acceptable; verdict is set from findings + prior commit message claims, not from rerunning per-wave gates.
metadata:
  type: feedback
---

For aggregate post-sprint reviews, `review.tasks` may legitimately be an empty array.

**Why:** Per-wave reviews already ran mechanical gates; the aggregate pass is Phase-2-only (audit findings). The validator (`validate-review.mjs`) accepts an empty tasks array — it only enforces the schema on entries that exist. The wave-level verdict is derived from blocking-finding count and whether prior iteration findings were addressed, NOT from rerunning gates.

**How to apply:** When called with `kind: aggregate-sprint-review` (per `meta.kind`), skip Phase 1. Verify each prior iteration finding by reading the relevant file at HEAD. Trust commit messages only enough to know what was *attempted* — always re-confirm the actual diff. Set `verdict: failed` if any prior blocking finding remains unaddressed, regardless of new findings count.

Related: [[review-verdict-enums]] for the per-task vs per-review verdict enum mismatch.
