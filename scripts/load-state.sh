#!/usr/bin/env bash
# load-state.sh — produce the state.json artifact for sprint-implementation.
#
# Inputs:  $SPRINT_ID env.
# Outputs: writes the current state JSON to stdout. Relay redirects stdout
#          into <run>/artifacts/state.json per `output: { artifact: 'state.json' }`.
# Exit:    0 always — a missing state file is bootstrapped from the sprint plan.
#
# State schema is §22. On a fresh sprint we synthesise an initial document so
# the wave-runner has consistent shape to read on entry.

SCRIPT_NAME="load-state"
# shellcheck source=_lib.sh
. "$(dirname "$0")/_lib.sh"

cd "$(project_root)"

require_cmd jq
require_env SPRINT_ID

state_file=".planning/state/${SPRINT_ID}.json"
sprint_file=".planning/sprints/${SPRINT_ID}.json"

[ -f "$sprint_file" ] || die 1 "sprint plan missing: $sprint_file"

if [ -f "$state_file" ]; then
  log "resuming from existing state"
  cat "$state_file"
  exit 0
fi

log "bootstrapping fresh state for $SPRINT_ID"
mkdir -p "$(dirname "$state_file")"

# Pull wave ids from the sprint and task ids from each wave's plan file.
# `compose-sprints` writes wave plans alongside the sprint; if they aren't
# inline, we fall back to leaving task_status empty and let the wave-runner
# populate it on first entry.
now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
branch=$(jq -r '.branch // ""' "$sprint_file")
waves_json=$(jq -c '.waves' "$sprint_file")

# Build wave_status with every wave set to "todo".
wave_status=$(jq -nc --argjson waves "$waves_json" '
  reduce $waves[] as $w ({}; .[$w] = "todo")
')

# Try to load tasks from a sibling file; absence is non-fatal.
task_status="{}"
tasks_file=".planning/sprints/${SPRINT_ID}.tasks.json"
if [ -f "$tasks_file" ]; then
  task_status=$(jq -c '
    [.tasks[]?.id] | map({(.): "todo"}) | add // {}
  ' "$tasks_file")
fi

state=$(jq -nc \
  --arg sprint_id "$SPRINT_ID" \
  --arg branch "$branch" \
  --arg started_at "$now" \
  --arg current_wave "$(jq -r '.waves[0] // ""' "$sprint_file")" \
  --argjson wave_status "$wave_status" \
  --argjson task_status "$task_status" \
  '{
     schema_version: 1,
     sprint_id: $sprint_id,
     branch: $branch,
     started_at: $started_at,
     current_wave: $current_wave,
     wave_status: $wave_status,
     task_status: $task_status,
     in_flight: [],
     last_commit_sha: null,
     checkpoints: [],
     blocked_tasks: []
   }')

# Persist for the next resume, then echo to stdout for the artifact.
printf '%s\n' "$state" >"$state_file"
printf '%s\n' "$state"
