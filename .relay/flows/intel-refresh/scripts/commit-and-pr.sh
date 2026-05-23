#!/usr/bin/env bash
# commit-and-pr.sh — final step of the intel-refresh flow.
#
# Why this exists: each relay flow runs in its own worktree which is torn
# down on completion. The intel-refresh flow rewrites INTEL.md and
# .planning/intel/* — if those changes aren't committed and pushed they
# vanish with the worktree. This script lands them on `sdlc/intel-refresh`
# and opens (or updates) a PR against main.
#
# Inputs:  none — reads files on disk produced by upstream patch step.
# Outputs: one git commit, a best-effort push, and a best-effort PR.
# Exit:    0 on success or "no diff to commit" (intel-refresh runs are
#          frequently no-ops, which is expected and not a failure).

SCRIPT_NAME="commit-intel-refresh"
# shellcheck source=_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd git

branch="sdlc/intel-refresh"
current=$(git rev-parse --abbrev-ref HEAD)
if [ "$current" != "$branch" ]; then
  die 1 "expected to be on $branch but on $current — did branch.sh run?"
fi

if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  log "no intel changes — $branch already up-to-date"
  exit 0
fi

# Stage canonical intel-refresh outputs only.
to_add=()
for path in INTEL.md .planning/intel; do
  [ -e "$path" ] && to_add+=("$path")
done
[ "${#to_add[@]}" -eq 0 ] && die 0 "nothing to add"

git add "${to_add[@]}"

changed_files=$(git diff --cached --name-only | wc -l | tr -d ' ')

git commit -m "$(cat <<EOF
chore(intel): refresh INTEL.md and .planning/intel snapshot

${changed_files} file(s) updated to reflect HEAD.
EOF
)"

# Best-effort push.
has_remote=0
if git remote get-url origin >/dev/null 2>&1; then
  has_remote=1
  log "pushing $branch to origin (force-with-lease)"
  if ! git push --force-with-lease -u origin "$branch" 2>&1 | tail -n 20; then
    log "push failed — leaving branch local; user can push manually"
  fi
else
  log "no origin remote — leaving branch local"
fi

# Best-effort PR.
if [ "$has_remote" = "1" ] && command -v gh >/dev/null 2>&1; then
  body_file=$(mktemp)
  trap 'rm -f "$body_file"' EXIT
  {
    printf '## Summary\n\nDiff-only refresh of INTEL.md and `.planning/intel/*` against HEAD.\n\n'
    printf -- '- **%s** file(s) updated\n\n' "$changed_files"
    printf '🤖 Opened by relay run intel-refresh\n'
  } >"$body_file"

  existing=$(gh pr view "$branch" --json url --jq '.url' 2>/dev/null || true)
  if [ -z "$existing" ]; then
    log "creating PR for $branch"
    set +e
    gh pr create \
      --base main \
      --head "$branch" \
      --title "intel: refresh INTEL.md snapshot" \
      --body-file "$body_file" 2>&1 | tail -n 5
    set -e
  else
    log "updating existing PR: $existing"
    gh pr edit "$existing" --body-file "$body_file" >/dev/null 2>&1 || \
      log "gh pr edit failed — leaving PR as-is"
  fi
fi

exit 0
