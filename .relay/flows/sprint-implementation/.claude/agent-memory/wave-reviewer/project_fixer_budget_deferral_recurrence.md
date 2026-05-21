---
name: project-fixer-budget-deferral-recurrence
description: review-fix-loop fixer prompt skips auto_fixable findings when budget pressure is detected, but the reviewer's R7.3 contract still requires escalating recurrences to blocking.
metadata:
  type: project
---

When the review-fix-loop's fixer dispatches a `fix_outcome.json` that lists `findings_skipped` with reasoning like `[budget] deferred to next iteration`, those skipped auto_fixable findings WILL recur on the next iteration's review unchanged.

**Why:** the loop's per-iteration dispatch budget is finite and the prompt prioritises blocking+auto_fixable over high/medium/low+auto_fixable. The deferral note is honest about the cause, but the reviewer's R7.3 contract reads "if the same auto_fixable: true finding appears in iteration N+1" without an exception for explicit deferrals — the escalation fires regardless.

**How to apply:** in iteration N+1, when you observe an auto_fixable finding that was `findings_skipped` (not `findings_addressed`) in `fix_outcome.json` iter-N, escalate to blocking per R7.3 AND add `meta.iter1_disposition: "deferred (skipped by fixer with [budget] reason)"`. The escalation flags a project-level gap (fixer prompt budget vs reviewer expectation) — the retro should reconcile them by either (a) raising the fixer's per-iteration cap when only auto_fixable findings remain or (b) softening R7.3 to permit deferrals when the fixer explicitly opted to skip. Until reconciled, expect this recurrence pattern on every iter-2.

Related: [[project-review-iter-carries-unhealed-blockers]] describes the symptom; this memory describes the proximate cause inside the fixer prompt.
