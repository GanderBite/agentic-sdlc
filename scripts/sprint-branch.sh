#!/usr/bin/env bash
# sprint-branch.sh — create and check out the sprint branch.
#
# Inputs:  $SPRINT_ID env, plus .planning/sprints/<id>.json on disk for the
#          canonical branch name.
# Outputs: a checked-out sprint branch.
# Exit:    0 if created (or already checked out, idempotent), 1 if the branch
#          exists at a divergent commit.
#
# Idempotent on re-entry per §9.4 — re-running on the same branch returns 0.

SCRIPT_NAME="sprint-branch"
# shellcheck source=_lib.sh
. "$(dirname "$0")/_lib.sh"

cd "$(project_root)"

require_cmd git jq
require_env SPRINT_ID

sprint_file=".planning/sprints/${SPRINT_ID}.json"
[ -f "$sprint_file" ] || die 1 "sprint plan missing: $sprint_file"

branch=$(jq -r '.branch' "$sprint_file")
if [ -z "$branch" ] || [ "$branch" = "null" ]; then
  # Fall back to a slug derived from the title.
  title=$(jq -r '.title // ""' "$sprint_file")
  slug=$(slugify "$title")
  branch="sprint/${SPRINT_ID#sprint-}-${slug}"
  log "sprint plan missing .branch — deriving $branch from title"
fi

current=$(git rev-parse --abbrev-ref HEAD)
if [ "$current" = "$branch" ]; then
  log "already on $branch"
  exit 0
fi

if git show-ref --verify --quiet "refs/heads/$branch"; then
  # Branch exists. Switch to it as long as the working tree is clean; that's
  # the resume case.
  if [ -n "$(git status --porcelain)" ]; then
    die 1 "branch $branch already exists and working tree is dirty — refuse to switch"
  fi
  log "branch $branch already exists — switching"
  git checkout "$branch"
  exit 0
fi

# Fresh branch from the current HEAD (the parent branch the user invoked
# `relay run sprint-implementation` from — typically `main`).
log "creating branch $branch from $(git rev-parse --short HEAD)"
git checkout -b "$branch"
