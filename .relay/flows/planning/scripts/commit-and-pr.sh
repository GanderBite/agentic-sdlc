#!/usr/bin/env bash
# commit-and-pr.sh — final step of the planning flow.
#
# Why this exists: each relay flow runs in its own worktree which is torn
# down on completion. Outputs that aren't committed and pushed to origin
# are lost. This script lands the planning outputs (one sprint + its
# tasks/waves/coverage, plus any intel-refresh side effects) on a stable
# branch derived from the produced sprint id and opens (or updates) a PR
# against main.
#
# Branch:  `sdlc/plan-<sprintId>` — derived from the newest file under
#          .planning/sprints/sprint-*.json (sprintId already has the
#          `sprint-` prefix in some setups; we strip it for the branch).
#
# Inputs:  none — reads files on disk produced by upstream steps.
# Outputs: one git commit, a best-effort push, and a best-effort PR.
# Exit:    0 on success or "nothing to commit"; non-zero only if git
#          itself errors.

SCRIPT_NAME="commit-planning"
# shellcheck source=_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd git jq

# branch.sh ran first and parked us on sdlc/plan-<feature-slug>. We pull
# the sprint id from the produced plan file (for commit message / PR body)
# but the branch is already set.
sprint_file=$(ls -t .planning/sprints/sprint-*.json 2>/dev/null | head -n 1 || true)
sprint_id=""
if [ -n "$sprint_file" ]; then
  sprint_id=$(jq -r '.id // ""' "$sprint_file")
fi

branch=$(git rev-parse --abbrev-ref HEAD)
case "$branch" in
  sdlc/plan-*) : ok ;;
  *) die 1 "expected to be on an sdlc/plan-* branch but on $branch — did branch.sh run?" ;;
esac

if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  log "no changes to commit — $branch already up-to-date"
  exit 0
fi

# Stage canonical planning outputs. The intel-refresh sub-step may have
# rewritten INTEL.md / .planning/intel/* — include them so the PR is
# self-contained.
to_add=()
for path in .planning/sprints .planning/features INTEL.md .planning/intel docs/ARCHITECTURE.md; do
  [ -e "$path" ] && to_add+=("$path")
done
[ "${#to_add[@]}" -eq 0 ] && die 0 "nothing to add"

git add "${to_add[@]}"

title=""
wave_count=0
task_count=0
if [ -n "$sprint_file" ]; then
  title=$(jq -r '.title // ""' "$sprint_file")
fi
if [ -n "$sprint_id" ] && [ -f ".planning/sprints/${sprint_id}.waves.json" ]; then
  wave_count=$(jq -r '.waves | length' ".planning/sprints/${sprint_id}.waves.json" 2>/dev/null || echo 0)
fi
if [ -n "$sprint_id" ] && [ -f ".planning/sprints/${sprint_id}.tasks.json" ]; then
  task_count=$(jq -r '.tasks | length' ".planning/sprints/${sprint_id}.tasks.json" 2>/dev/null || echo 0)
fi
# Surface a sensible label when the sprint file is missing (shouldn't
# happen post write-sprints, but keep the commit message valid).
sprint_label="${sprint_id:-plan}"

git commit -m "$(cat <<EOF
chore(planning): plan ${sprint_label} — ${task_count} task(s) across ${wave_count} wave(s)

- .planning/sprints/${sprint_label}.json (+ tasks, waves, coverage)
- INTEL.md and .planning/intel/* refreshed
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
    printf '## Summary\n\nPlan for `%s` — %s.\n\n' "$sprint_label" "$title"
    printf -- '- **%s** task(s) across **%s** wave(s)\n' "$task_count" "$wave_count"
    if [ -n "$sprint_id" ]; then
      printf '\n## Next\n\nRun `relay run sprint-implementation --input sprintId=%s --input repo=<owner/name>`.\n\n' "$sprint_id"
    fi
    printf '🤖 Opened by relay run planning\n'
  } >"$body_file"

  existing=$(gh pr view "$branch" --json url --jq '.url' 2>/dev/null || true)
  if [ -z "$existing" ]; then
    log "creating PR for $branch"
    set +e
    gh pr create \
      --base main \
      --head "$branch" \
      --title "planning: ${sprint_label} — ${title}" \
      --body-file "$body_file" 2>&1 | tail -n 5
    set -e
  else
    log "updating existing PR: $existing"
    gh pr edit "$existing" --body-file "$body_file" >/dev/null 2>&1 || \
      log "gh pr edit failed — leaving PR as-is"
  fi
fi

exit 0
