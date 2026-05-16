#!/usr/bin/env bash
# commit-and-pr.sh — final step of the discovery flow.
#
# Why this exists: each relay flow runs in its own worktree which is torn
# down on completion. Outputs that aren't committed and pushed to origin
# are lost. This script lands the feature specs on a stable branch
# (`sdlc/discovery`) and opens (or updates) a PR against main.
#
# Inputs:  none — reads files under .planning/features/ and docs/APPLICATION*.md.
# Outputs: one git commit on `sdlc/discovery`, a best-effort push, and a
#          best-effort PR via `gh`.
# Exit:    0 on success or "nothing to commit"; non-zero only if git itself
#          errors. Push / PR creation failures are logged but non-fatal,
#          since the work has at least been committed locally.

SCRIPT_NAME="commit-discovery"
# shellcheck source=_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd git

# branch.sh ran first and parked us on sdlc/discovery — just sanity-check.
branch="sdlc/discovery"
current=$(git rev-parse --abbrev-ref HEAD)
if [ "$current" != "$branch" ]; then
  die 1 "expected to be on $branch but on $current — did branch.sh run?"
fi

if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  log "no changes to commit — $branch already up-to-date"
  exit 0
fi

# Stage canonical discovery outputs only.
to_add=()
for path in .planning/features docs/APPLICATION.md docs/APPLICATION_BRIEF.md; do
  [ -e "$path" ] && to_add+=("$path")
done
[ "${#to_add[@]}" -eq 0 ] && die 0 "nothing to add"

git add "${to_add[@]}"

feature_count=0
if [ -f .planning/features/INDEX.json ]; then
  feature_count=$(jq -r '.total // 0' .planning/features/INDEX.json 2>/dev/null || echo 0)
fi

git commit -m "$(cat <<EOF
chore(discovery): decompose application into ${feature_count} feature spec(s)

- .planning/features/FEATURE-*.md per feature
- .planning/features/INDEX.json execution order
EOF
)"

# Best-effort push.
has_remote=0
if git remote get-url origin >/dev/null 2>&1; then
  has_remote=1
  # --force-with-lease: branch.sh force-resets the local branch to current
  # HEAD on each run, so the push is non-fast-forward by design. The
  # `--with-lease` guards against clobbering a parallel push.
  log "pushing $branch to origin"
  if ! git push --force-with-lease -u origin "$branch" 2>&1 | tail -n 20; then
    log "push failed — leaving branch local; user can push manually"
  fi
else
  log "no origin remote — leaving branch local"
fi

# Best-effort PR creation/update.
if [ "$has_remote" = "1" ] && command -v gh >/dev/null 2>&1; then
  body_file=$(mktemp)
  trap 'rm -f "$body_file"' EXIT
  {
    printf '## Summary\n\nDiscovery decomposed the application into %s feature spec(s).\n\n' "$feature_count"
    if [ -f .planning/features/INDEX.json ]; then
      printf '## Features\n\n'
      jq -r '.features[] | "- `" + .slug + "` — " + .title + " (~" + (.estimated_task_count|tostring) + " tasks)"' \
        .planning/features/INDEX.json 2>/dev/null || true
      printf '\n'
    fi
    printf '## Next\n\nRun `relay run planning --input featureSpec=.planning/features/FEATURE-<slug>.md` per feature in INDEX order.\n\n'
    printf '🤖 Opened by relay run discovery\n'
  } >"$body_file"

  existing=$(gh pr view "$branch" --json url --jq '.url' 2>/dev/null || true)
  if [ -z "$existing" ]; then
    log "creating PR for $branch"
    set +e
    gh pr create \
      --base main \
      --head "$branch" \
      --title "discovery: decompose application into ${feature_count} feature spec(s)" \
      --body-file "$body_file" 2>&1 | tail -n 5
    set -e
  else
    log "updating existing PR: $existing"
    gh pr edit "$existing" --body-file "$body_file" >/dev/null 2>&1 || \
      log "gh pr edit failed — leaving PR as-is"
  fi
fi

exit 0
