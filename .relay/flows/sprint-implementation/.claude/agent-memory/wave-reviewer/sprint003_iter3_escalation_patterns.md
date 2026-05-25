---
name: sprint003-iter3-escalation-patterns
description: Sprint-003 iter-3 final review — 3 auto_fixable findings survived all 3 iterations; fixer dispatch scope mismatch is the root cause
metadata:
  type: project
---

Sprint-003 review-iter-3 (final iteration, 2026-05-25) found 3 R7.3 escalations:

1. **nginx.conf security headers** — nginx proxy_pass missing X-Forwarded-Proto and security response headers. First seen iter-2 as medium, escalated to blocking in iter-3. Fixer likely never touched nginx.conf because it's not a TS file and Builder protocols are TS-focused.

2. **apps/api/src/main.ts useLiteralKeys** — biome info-level diagnostic (process.env['KEY'] vs process.env.KEY). First seen iter-2. Fixer was likely scoped to apps/ui only (sprint-003 focus is UI scaffold), so the apps/api file was never targeted.

3. **csrf.test.ts stale /v1/auth comments** — Comment references old path scheme. First seen iter-1 (!), survived iter-2 fix, and iter-3. Fixer dispatch is unreliable for comment-only changes in test files.

**Root cause pattern:** Fixer dispatch is scoped too narrowly (per-workspace or per-file-type), so findings in "adjacent" files that were also changed in the sprint but are outside the primary workspace never get fixed. This is a systemic issue in the review-fix-loop design.

**Why:** The Builder protocol runs biome --write only on `${TARGET_FILES}`, and the fixer inherits the same scope. Cross-workspace findings (apps/api files touched by a UI sprint) fall through.

**How to apply:** In future reviews, flag cross-workspace auto_fixable findings early in iter-1 as high (not medium/low) so they get prioritized. Also consider whether `auto_fixable: true` is appropriate when the fixer cannot reach the file.
