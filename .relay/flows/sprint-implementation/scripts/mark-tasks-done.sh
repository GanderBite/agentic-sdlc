#!/usr/bin/env bash
# mark-tasks-done.sh — final body step of the wave-loop.
#
# Deterministic state update that runs AFTER `wave-commit`. Reads the
# wave_outcome handoff the wave-runner just produced and applies the
# task-level + wave-level state transitions:
#
#   - For every id in wave_outcome.tasks_done   → task_status[id] = "done"
#   - For every id in wave_outcome.tasks_blocked → task_status[id] = "blocked"
#   - For every id in wave_outcome.tasks_failed  → task_status[id] = "failed"
#   - If every task in this wave is in a terminal status
#     (done|blocked|failed|skipped), set wave_status[wave_id] = "done".
#
# Pairs with mark-tasks-in-progress.sh: state transitions are now purely
# script-driven, removing them from the wave-runner LLM's responsibility.
# This is the second half of the deterministic-state-management refactor.
#
# Inputs:  $SPRINT_ID env, $RELAY_HANDOFFS_DIR env (set by relay).
# Outputs: in-place update of .planning/state/$SPRINT_ID.json.
# Exit:    0 = state updated (or no-op when wave_outcome is absent —
#              defensive; shouldn't happen since this step depends on
#              wave-commit which depends on wave).
#          1 = missing input file / env / jq.

SCRIPT_NAME="mark-tasks-done"
# shellcheck source=../../../../scripts/_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd jq
require_env SPRINT_ID RELAY_HANDOFFS_DIR

state_file=".planning/state/${SPRINT_ID}.json"
waves_file=".planning/sprints/${SPRINT_ID}.waves.json"
outcome="$RELAY_HANDOFFS_DIR/wave-loop/wave_outcome.json"

[ -f "$state_file" ] || die 1 "missing state file: $state_file"
[ -f "$waves_file" ] || die 1 "missing waves file: $waves_file"
[ -f "$outcome" ] || die 1 "missing handoff: $outcome"

wave_id=$(jq -r '.wave_id // empty' "$outcome")
[ -n "$wave_id" ] || die 1 "wave_outcome.wave_id is empty"

# Look up this wave's full task list — we need it to decide whether the
# wave is now fully resolved.
wave_tasks=$(jq -c --arg w "$wave_id" '
  .waves[] | select(.id == $w) | .tasks
' "$waves_file")

if [ -z "$wave_tasks" ] || [ "$wave_tasks" = "null" ]; then
  die 1 "wave $wave_id not found in $waves_file"
fi

log "wave $wave_id: applying task transitions from wave_outcome"

# Single jq pass: apply per-task transitions, then check wave completion.
tmp=$(mktemp)
jq \
  --arg w "$wave_id" \
  --argjson wave_tasks "$wave_tasks" \
  --slurpfile o "$outcome" \
  '
    ($o[0].tasks_done    // []) as $done
    | ($o[0].tasks_blocked // []) as $blocked
    | ($o[0].tasks_failed  // []) as $failed
    | reduce $done[]    as $id (.; .task_status[$id] = "done")
    | reduce $blocked[] as $id (.; .task_status[$id] = "blocked")
    | reduce $failed[]  as $id (.; .task_status[$id] = "failed")
    # Wave is done when every task in $wave_tasks has a terminal status.
    # `.` here is the updated state (post-reduce); capture it so the inner
    # comprehension can index task_status by each $wave_tasks entry.
    | . as $next
    | ([$wave_tasks[] | $next.task_status[.] // "todo"]) as $statuses
    | if ($statuses | all(. == "done" or . == "blocked" or . == "failed" or . == "skipped"))
      then .wave_status[$w] = "done"
      else .
      end
  ' "$state_file" >"$tmp"
mv -f "$tmp" "$state_file"

# Surface what just happened — useful when tailing run.log.
new_wave_status=$(jq -r --arg w "$wave_id" '.wave_status[$w] // "unknown"' "$state_file")
log "wave $wave_id: status=$new_wave_status; task transitions applied (done=$(jq -r '.tasks_done | length' "$outcome"), blocked=$(jq -r '.tasks_blocked | length' "$outcome"), failed=$(jq -r '.tasks_failed | length' "$outcome"))"
