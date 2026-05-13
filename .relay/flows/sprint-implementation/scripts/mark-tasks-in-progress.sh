#!/usr/bin/env bash
# mark-tasks-in-progress.sh — first body step of the wave-loop.
#
# Deterministic state update that runs BEFORE the wave-runner LLM. Reads
# the durable state + the sprint's wave plan to find the next wave whose
# `wave_status` is not `"done"`, then flips each of that wave's tasks
# from `"todo"` to `"in_progress"`.
#
# This pre-empties the wave-runner of state-writing responsibility, which
# proved unreliable in earlier runs (the LLM hallucinated state writes,
# producing wave_outcome handoffs whose tasks_done lists didn't actually
# match any executed work). State transitions in→out of "in_progress" are
# now purely script-driven.
#
# Inputs:  $SPRINT_ID env.
# Outputs: in-place update of .planning/state/$SPRINT_ID.json.
# Exit:    0 = state updated (or no-op when all waves done — wave-runner
#              will then emit all_waves_done: true).
#          1 = missing input file / SPRINT_ID / jq.

SCRIPT_NAME="mark-tasks-in-progress"
# shellcheck source=../../../../scripts/_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd jq
require_env SPRINT_ID

state_file=".planning/state/${SPRINT_ID}.json"
waves_file=".planning/sprints/${SPRINT_ID}.waves.json"
sprint_file=".planning/sprints/${SPRINT_ID}.json"

[ -f "$state_file" ] || die 1 "missing state file: $state_file (run load-state first)"
[ -f "$waves_file" ] || die 1 "missing waves file: $waves_file"
[ -f "$sprint_file" ] || die 1 "missing sprint file: $sprint_file"

# Pick the first wave in sprint.waves whose wave_status[id] != "done".
next_wave=$(jq -r --slurpfile state "$state_file" '
  .waves
  | map(select(($state[0].wave_status // {})[.] != "done"))
  | .[0] // empty
' "$sprint_file")

if [ -z "$next_wave" ]; then
  log "all waves already marked done — leaving state untouched (wave-runner will emit all_waves_done)"
  exit 0
fi

# Pull this wave's task ids from the wave plan.
task_ids=$(jq -c --arg w "$next_wave" '
  .waves[] | select(.id == $w) | .tasks
' "$waves_file")

if [ -z "$task_ids" ] || [ "$task_ids" = "null" ]; then
  die 1 "wave $next_wave not found in $waves_file, or has no tasks[]"
fi

log "wave $next_wave: marking $(printf '%s' "$task_ids" | jq -r 'length') task(s) in_progress"

# Atomic update: set task_status[id] = "in_progress" for each task whose
# current status is "todo" (skip ones already terminal or in-flight).
tmp=$(mktemp)
jq --arg w "$next_wave" --argjson tasks "$task_ids" '
  .current_wave = $w
  | reduce $tasks[] as $tid (.;
      if ((.task_status // {})[$tid] == "todo") then
        .task_status[$tid] = "in_progress"
      else . end
    )
' "$state_file" >"$tmp"
mv -f "$tmp" "$state_file"

log "state updated: current_wave=$next_wave"
