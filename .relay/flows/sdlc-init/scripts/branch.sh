#!/usr/bin/env bash
# branch.sh — first step of the sdlc-init flow.
#
# Why this exists: relay flows run in a worktree whose auto-branch is
# reaped on completion, so any commits made there vanish. We switch to
# `sdlc/init` BEFORE the flow writes any docs, skills, or intel so every
# subsequent write lands on a pushable, persistent branch. Previously
# this was deferred to the final commit step via `git checkout -B` on a
# dirty tree (see history of commit-sdlc-init.sh); doing it up-front
# while the tree is still clean is simpler and avoids the `-B`-on-dirty-
# tree workaround.
#
# Strategy: `git checkout -B` from a clean tree. sdlc-init is a fresh
# bootstrap snapshot, so resetting the branch to current HEAD is the
# intended semantic. The commit step pushes with `--force-with-lease`
# so a re-run updates the existing PR cleanly.
#
# Special case: if `.git` doesn't exist (e.g. sdlc-init is bootstrapping
# a brand-new repo), `git init` runs first.
#
# Inputs:  none.
# Outputs: HEAD repointed to `sdlc/init`.
# Exit:    0 on success.

SCRIPT_NAME="branch-sdlc-init"
# shellcheck source=_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd git

branch="sdlc/init"

# Bootstrap a repo if there isn't one — sdlc-init may be invoked on a
# fresh starter directory.
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  log "no git repository — initializing"
  git init -q
fi

if [ -n "$(git status --porcelain)" ]; then
  die 1 "working tree is dirty — refuse to switch to $branch"
fi

if git remote get-url origin >/dev/null 2>&1; then
  git fetch origin "$branch" 2>/dev/null || true
fi

current=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [ "$current" = "$branch" ]; then
  log "already on $branch"
  exit 0
fi

log "creating/resetting $branch onto $(git rev-parse --short HEAD 2>/dev/null || echo 'fresh init')"
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  git checkout -B "$branch"
else
  # Empty repo (no commits yet) — `checkout -B` errors. Use orphan-style
  # `checkout --orphan`.
  git checkout --orphan "$branch"
fi
