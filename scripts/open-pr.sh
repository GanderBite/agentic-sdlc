#!/usr/bin/env bash
# open-pr.sh — open or update the PR for the sprint branch.
#
# Inputs:  $SPRINT_ID, $REPO env (`owner/name`), optional $DRY_RUN=1.
# Outputs: PR url on stdout (best-effort).
# Exit:    0 always — failures are logged and don't abort the sprint, since
#          the work has already landed on the branch.
#
# Idempotent: `gh pr create` if no PR exists; otherwise `gh pr edit`. When
# `--dry-run` mode was used, opens as a draft PR.

SCRIPT_NAME="open-pr"
# shellcheck source=_lib.sh
. "$(dirname "$0")/_lib.sh"

cd "$(project_root)"

require_cmd git gh
require_env SPRINT_ID REPO

sprint_file=".planning/sprints/${SPRINT_ID}.json"
state_file=".planning/state/${SPRINT_ID}.json"
blocked_dir=".planning/blocked/${SPRINT_ID}"
retro_md=".planning/retros/${SPRINT_ID}.md"
report_html="${RELAY_RUN_DIR:-}/artifacts/report.html"

title="${SPRINT_ID}"
branch=$(git rev-parse --abbrev-ref HEAD)
if [ -f "$sprint_file" ]; then
  title=$(jq -r '.title // ""' "$sprint_file" 2>/dev/null || echo "$SPRINT_ID")
fi

# Push the branch first so the PR has commits to point at.
if git remote get-url origin >/dev/null 2>&1; then
  git push -u origin "$branch" 2>&1 | tail -n 5 || log "push failed — PR may not have latest commits"
fi

# Build PR body.
body_file=$(mktemp)
trap 'rm -f "$body_file"' EXIT
{
  printf '## Summary\n\nSprint `%s` — %s\n\n' "$SPRINT_ID" "$title"
  if [ -f "$state_file" ]; then
    printf '## Waves\n\n'
    jq -r '
      .wave_status | to_entries[] |
      "- `" + .key + "` — " + .value
    ' "$state_file" 2>/dev/null || true
    printf '\n'
  fi
  if [ -d "$blocked_dir" ]; then
    blocked_count=$(find "$blocked_dir" -maxdepth 1 -name "*.md" | wc -l | tr -d ' ')
    if [ "$blocked_count" -gt 0 ]; then
      printf '## Blocked tasks (%s)\n\n' "$blocked_count"
      for f in "$blocked_dir"/*.md; do
        [ -f "$f" ] || continue
        printf -- '- `%s`\n' "$(basename "$f")"
      done
      printf '\n'
    fi
  fi
  if [ -f "$retro_md" ]; then
    printf '## Retro\n\nSee [`%s`](%s).\n\n' "$retro_md" "$retro_md"
  fi
  if [ -f "$report_html" ]; then
    printf '_Report attached as `report.html` artifact._\n'
  fi
  printf '\n🤖 Opened by relay run sprint-implementation\n'
} >"$body_file"

# Decide draft vs ready: any blocked tasks → keep as draft (or it's a dry run).
draft_flag=()
if [ "${DRY_RUN:-}" = "1" ] || [ "${DRY_RUN:-}" = "true" ]; then
  draft_flag+=(--draft)
elif [ -d "$blocked_dir" ] && find "$blocked_dir" -maxdepth 1 -name "*.md" | grep -q .; then
  draft_flag+=(--draft)
fi

label_args=()
if [ -d "$blocked_dir" ] && find "$blocked_dir" -maxdepth 1 -name "*.md" | grep -q .; then
  label_args+=(--label BLOCKED)
fi

# Does a PR already exist for this branch?
existing=$(gh pr view --repo "$REPO" --json url --jq '.url' 2>/dev/null || true)
if [ -z "$existing" ]; then
  log "creating PR on $REPO from $branch"
  set +e
  url=$(gh pr create \
    --repo "$REPO" \
    --base main \
    --head "$branch" \
    --title "$title" \
    --body-file "$body_file" \
    "${draft_flag[@]}" \
    "${label_args[@]}" 2>&1)
  status=$?
  set -e
  if [ $status -ne 0 ]; then
    log "gh pr create failed: $url"
    # Don't abort — the branch is pushed; the user can open the PR manually.
    exit 0
  fi
  printf '%s\n' "$url"
else
  log "updating existing PR: $existing"
  gh pr edit "$existing" --title "$title" --body-file "$body_file" "${label_args[@]}" >/dev/null || \
    log "gh pr edit failed — leaving PR as-is"
  printf '%s\n' "$existing"
fi
