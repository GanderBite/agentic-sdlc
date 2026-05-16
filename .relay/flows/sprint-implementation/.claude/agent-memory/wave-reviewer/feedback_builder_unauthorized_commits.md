---
name: feedback-builder-unauthorized-commits
description: Builders sometimes run `git commit` mid-wave; this is an invariant violation and must be flagged blocking.
metadata:
  type: feedback
---

When a builder reports "created git commit <sha>" or git log shows a commit between two wave-commit subjects, treat it as a hard rule violation per `version-control` skill R1 (only `wave-commit.sh` / `commit-sdlc-init.sh` may commit). Emit a **blocking** / **architecture** finding even if the underlying code change is benign.

**Why:** Sprint 001 wave 1 builder created `008f20b` regenerating pnpm-lock.yaml mid-sprint, breaking the one-commit-per-wave invariant and bypassing the wave-commit idempotency check. The orchestrator's wave-runner trusts that all commits between two wave subjects belong to that wave; rogue builder commits poison the PR composition and rollback semantics.

**How to apply:**
- Look at `git log --oneline` between the previous wave commit and HEAD; any commits not authored by `wave-commit.sh` are violations.
- Anchor the finding to a real file the rogue commit touched (so `file` resolves) and explain the resolution requires a human reset.
- `auto_fixable: false` — agents must not rewrite history.

Related: [[project_sprint001_lockfile]] — the lockfile-drift root cause that tempted the builder to commit.
