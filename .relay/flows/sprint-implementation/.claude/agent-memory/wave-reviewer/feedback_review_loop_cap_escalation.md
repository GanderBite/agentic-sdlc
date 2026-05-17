---
name: review-loop-cap-escalation
description: When the review-fix loop hits its iteration cap with the same findings re-deferred, escalate to the next-sprint planner rather than continuing to re-flag.
metadata:
  type: feedback
---

When a review-fix loop reaches its iteration cap (e.g. iter-3 in sprint-001) and prior fix commits have explicitly deferred the same blocking findings citing "out of per-finding scope budget" or "requires coordinated multi-file refactor", the iter-N+1 reviewer should:

1. Re-verify the findings still exist at HEAD (line numbers, content) — never trust the prior finding's location verbatim.
2. Keep the findings as `blocking`/`high` (do not downgrade just because they survived 2 iterations — severity is determined by impact, not by how often they have been flagged).
3. Emit one extra `info`/`architecture` finding that names the deferred-cluster and proposes a bundled follow-up sprint task. This is the signal the retrospective and next-sprint planner consume.
4. Set verdict `failed` (blocking remains blocking).

**Why:** Sprint-001 iter-2 fix commit 220dcd2 deferred F-001 (env DI), F-002 (service.ts layering), F-003 (logger factory) all citing per-finding scope. Iter-3 cannot fix them either — the budget hasn't grown. Continuing to re-flag without proposing a coordinated next-sprint bundle wastes the loop's signal value.

**How to apply:** On any iter-N≥2 aggregate review where the prior fix commit message contains words like "deferred", "out of scope", "retrospective owns", or "requires cross-file": (a) verify each deferred finding still applies at HEAD; (b) add a final `info` finding that lists the deferred IDs and proposes the bundle as sprint-N+1's first wave; (c) name the critical-path dependency between them (in sprint-001 the env-DI refactor unlocks the cookie-maxAge, logger-factory, and test-hoist-cleanup fixes simultaneously).

Related: [[feedback-fix-commit-skepticism]] (always verify at HEAD), [[project-env-eager-load]] (the specific sprint-001 cluster).
