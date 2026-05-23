#!/usr/bin/env bash
# branch.sh — first step of the intel-refresh flow.
#
# Why this exists: relay flows run in a worktree whose auto-branch is
# reaped on completion, so any commits made there vanish. We switch to
# `sdlc/intel-refresh` BEFORE the patch step writes anything so the
# refreshed INTEL.md / .planning/intel/* lands on a pushable branch.
#
# Strategy: `git checkout -B` from a clean tree, taking the current HEAD
# (typically main) as the parent so the intel diff is computed against
# the right base. Each intel-refresh run is a fresh snapshot — the commit
# step pushes with `--force-with-lease` so the matching PR updates cleanly.
#
# Inputs:  none.
# Outputs: HEAD repointed to `sdlc/intel-refresh`.
# Exit:    0 on success.

SCRIPT_NAME="branch-intel-refresh"
# shellcheck source=_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd git

branch="sdlc/intel-refresh"

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
