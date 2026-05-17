---
name: fix-commit-skepticism
description: Fix-iteration commit messages often list "skipped" findings honestly — but the "fixed" ones still need diff verification because partial fixes are common.
metadata:
  type: feedback
---

When an iter-N fix commit message says `Fixed: F-X, F-Y` and `Skipped: F-Z`, treat both lists as claims, not facts.

**Why:** Observed in sprint-001 c9129cd: the fix-iter-1 commit correctly identified deferred items, but the "fixed" items needed re-verification at HEAD because (a) the singleton in env.ts was untouched despite an env.ts diff (CORS_ORIGIN was added, NOT the singleton removal), and (b) the F-005 CORS fix introduced a subtle new gap (null-origin handling has unclear failure semantics) worth flagging at medium.

**How to apply:** For every "claimed fixed" finding, read the file at HEAD and confirm the exact line/symbol from the original finding is actually changed. For every "deferred" finding, also read the file — sometimes a deferred item is partially addressed by a tangential edit. Surface BOTH (a) finding-still-present (carry-forward with same id and severity) and (b) finding-newly-introduced-by-fix (new id) in the iter-N+1 output.
