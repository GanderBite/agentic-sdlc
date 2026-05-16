#!/usr/bin/env bash
# branch.sh — first step of the discovery flow.
#
# Why this exists: relay flows run in a worktree that auto-creates a branch
# like `relay/<runId>`. That branch gets reaped with the worktree, so any
# commits made there are lost. We switch to `sdlc/discovery` BEFORE the
# flow writes anything, so every subsequent commit lands on a branch that
# survives worktree teardown and is pushable to origin.
#
# Strategy: `git checkout -B` (force-create-or-reset) from a clean working
# tree. Each `relay run discovery` produces a fresh feature decomposition,
# so resetting `sdlc/discovery` to the parent HEAD is the intended
# semantic — prior runs' commits are replaced. Push step downstream uses
# `--force-with-lease` so the matching origin branch is updated cleanly.
#
# Inputs:  none.
# Outputs: HEAD repointed to `sdlc/discovery`.
# Exit:    0 on success.

SCRIPT_NAME="branch-discovery"
# shellcheck source=_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd git

branch="sdlc/discovery"

# Refuse on a dirty worktree — branch.sh is supposed to be the first thing
# the flow does, so dirty tree means something upstream went wrong.
if [ -n "$(git status --porcelain)" ]; then
  die 1 "working tree is dirty — refuse to switch to $branch"
fi

# Pull the latest origin/<branch> if a remote exists, so a subsequent push
# is a fast-forward (or a benign force-with-lease).
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
