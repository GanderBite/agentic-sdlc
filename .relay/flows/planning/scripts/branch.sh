#!/usr/bin/env bash
# branch.sh — first step of the planning flow.
#
# Why this exists: relay flows run in a worktree whose auto-branch is
# reaped on completion, so any commits made there vanish. We switch to a
# dedicated, per-feature branch BEFORE writing anything so the work lands
# on a pushable, persistent branch.
#
# Branch:  `sdlc/plan-<slug>`, where <slug> is parsed from the input
#          featureSpec path (e.g. `.planning/features/FEATURE-auth.md`
#          → slug `auth`). One feature → one plan branch → one PR.
#
# Strategy: `git checkout -B` from a clean tree. Re-running planning for
# the same feature replaces the prior plan; the commit step pushes with
# `--force-with-lease` so the corresponding PR updates cleanly.
#
# Inputs:  $FEATURE_SPEC env (planning flow input).
# Outputs: HEAD repointed to `sdlc/plan-<slug>`.
# Exit:    0 on success, 1 if $FEATURE_SPEC is missing / cannot derive slug.

SCRIPT_NAME="branch-planning"
# shellcheck source=_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd git
require_env FEATURE_SPEC

# Derive slug from the featureSpec path. Accepts both with-and-without
# the `FEATURE-` prefix and with-or-without the `.md` extension so the
# script is forgiving of small input variations.
basename=$(basename "$FEATURE_SPEC" .md)
slug="${basename#FEATURE-}"
[ -n "$slug" ] || die 1 "could not derive slug from FEATURE_SPEC=$FEATURE_SPEC"

branch="sdlc/plan-${slug}"

if [ -n "$(git status --porcelain)" ]; then
  die 1 "working tree is dirty — refuse to switch to $branch"
fi

if git remote get-url origin >/dev/null 2>&1; then
  git fetch origin "$branch" 2>/dev/null || true
fi

current=$(git rev-parse --abbrev-ref HEAD)
if [ "$current" = "$branch" ]; then
  log "already on $branch"
  exit 0
fi

log "creating/resetting $branch onto $(git rev-parse --short HEAD)"
git checkout -B "$branch"
