#!/usr/bin/env bash
# wave-commit.sh — produce the atomic per-wave commit (§12).
#
# Inputs:  $SPRINT_ID, $WAVE_ID env.
# Outputs: one git commit on the sprint branch.
# Exit:    0 = committed (or idempotently already committed for this wave).
#          1 = nothing to commit (no diff staged + checkpoint already records this wave).
#          2 = git error.
#
# Conventional message: `feat(<scope>): wave-<n> — <wave title>`.
# Scope is derived from the sprint title slug; wave title comes from
# `.planning/sprints/<id>.json` if present, otherwise the wave id.

SCRIPT_NAME="wave-commit"
# shellcheck source=_lib.sh
. "$(dirname "$0")/_lib.sh"

cd "$(project_root)"

require_cmd git jq
require_env SPRINT_ID WAVE_ID

state_file=".planning/state/${SPRINT_ID}.json"
sprint_file=".planning/sprints/${SPRINT_ID}.json"

# Idempotency check: did we already commit this wave?
if [ -f "$state_file" ] \
   && jq -e --arg w "$WAVE_ID" '(.checkpoints // []) | any(.wave == $w)' "$state_file" >/dev/null 2>&1; then
  log "wave $WAVE_ID already checkpointed — skipping commit"
  exit 0
fi

# Anything to commit?
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  log "no changes to commit for $WAVE_ID"
  exit 1
fi

scope="sdlc"
wave_title="$WAVE_ID"
if [ -f "$sprint_file" ]; then
  sprint_title=$(jq -r '.title // ""' "$sprint_file")
  [ -n "$sprint_title" ] && scope=$(slugify "$sprint_title")
fi
# wave title (if compose-waves persisted one alongside the sprint).
waves_file=".planning/sprints/${SPRINT_ID}.waves.json"
if [ -f "$waves_file" ]; then
  found=$(jq -r --arg w "$WAVE_ID" '.waves[] | select(.id == $w) | .title // empty' "$waves_file")
  [ -n "$found" ] && wave_title="$found"
fi

# Compute the wave number for the message: wave-3 → 3, wave-smoke → smoke.
wave_num="${WAVE_ID#wave-}"
msg="feat(${scope}): wave-${wave_num} — ${wave_title}"

log "committing wave $WAVE_ID: $msg"
git add -A
if ! git commit -m "$msg"; then
  die 2 "git commit failed"
fi

sha=$(git rev-parse HEAD)

# Update state with the new checkpoint atomically.
if [ -f "$state_file" ]; then
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  tmp=$(mktemp)
  jq --arg sha "$sha" \
     --arg w "$WAVE_ID" \
     --arg at "$now" \
     '
       .last_commit_sha = $sha
       | .checkpoints = ((.checkpoints // []) + [{ at: $at, wave: $w, sha: $sha }])
       | .wave_status[$w] = "done"
     ' "$state_file" >"$tmp"
  mv -f "$tmp" "$state_file"
fi

log "wave committed at $sha"
exit 0
