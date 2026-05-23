#!/usr/bin/env bash
# sync-sprint-status.sh — mirror durable state into the sprint plan files.
#
# The wave-loop owns task/wave status in .planning/state/${SPRINT_ID}.json
# (the durable state, mutated by mark-tasks-{in-progress,done}.sh). The
# user-facing sprint plan files at .planning/sprints/${SPRINT_ID}.*.json
# are otherwise immutable definitions — so a completed run leaves them
# reading "todo" everywhere. This script keeps the plan files visually
# accurate by mirroring the state file's statuses back into them.
#
# Reads:  .planning/state/${SPRINT_ID}.json
# Writes: .planning/sprints/${SPRINT_ID}.json        (.status + timestamps)
#         .planning/sprints/${SPRINT_ID}.waves.json  (.waves[].status)
#         .planning/sprints/${SPRINT_ID}.tasks.json  (.tasks[].status)
#
# Sprint-level status rollup (from wave_status values):
#   all "done"                                          → "done" + completed_at
#   any "in_progress" | "blocked" | "failed"
#     | any non-"todo"                                  → "in_progress" + started_at
#   otherwise (all "todo" or empty)                     → "todo"
#
# Idempotent: re-running with the same state produces no diff. Each file
# write is atomic (jq → tmp → mv).

SCRIPT_NAME="sync-sprint-status"
# shellcheck source=../../../../scripts/_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd jq
require_env SPRINT_ID

state_file=".planning/state/${SPRINT_ID}.json"
sprint_file=".planning/sprints/${SPRINT_ID}.json"
waves_file=".planning/sprints/${SPRINT_ID}.waves.json"
tasks_file=".planning/sprints/${SPRINT_ID}.tasks.json"

[ -f "$state_file" ]  || die 1 "missing state file: $state_file"
[ -f "$sprint_file" ] || die 1 "missing sprint file: $sprint_file"

now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# ---- waves.json: mirror per-wave status ----
if [ -f "$waves_file" ]; then
  tmp=$(mktemp)
  jq --slurpfile s "$state_file" '
    .waves |= map(.status = (($s[0].wave_status // {})[.id] // .status // "todo"))
  ' "$waves_file" > "$tmp"
  mv -f "$tmp" "$waves_file"
fi

# ---- tasks.json: mirror per-task status ----
if [ -f "$tasks_file" ]; then
  tmp=$(mktemp)
  jq --slurpfile s "$state_file" '
    .tasks |= map(.status = (($s[0].task_status // {})[.id] // .status // "todo"))
  ' "$tasks_file" > "$tmp"
  mv -f "$tmp" "$tasks_file"
fi

# ---- sprint.json: top-level status + lifecycle timestamps ----
tmp=$(mktemp)
jq --slurpfile s "$state_file" --arg now "$now" '
  (($s[0].wave_status // {}) | to_entries | map(.value)) as $vals
  | (if   ($vals | length) > 0 and ($vals | all(. == "done"))   then "done"
     elif ($vals | any(. == "in_progress"))                     then "in_progress"
     elif ($vals | any(. == "blocked" or . == "failed"))        then "in_progress"
     elif ($vals | any(. != "todo"))                            then "in_progress"
     else "todo" end) as $new_status
  | .status = $new_status
  | (if $new_status == "in_progress" and (.started_at // null) == null
       then .started_at = $now else . end)
  | (if $new_status == "done"        and (.completed_at // null) == null
       then .completed_at = $now else . end)
' "$sprint_file" > "$tmp"
mv -f "$tmp" "$sprint_file"

new_status=$(jq -r '.status' "$sprint_file")
log "synced: sprint.status=$new_status"
