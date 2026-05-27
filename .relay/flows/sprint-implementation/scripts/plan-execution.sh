#!/usr/bin/env bash
# plan-execution.sh — deterministic replacement for the LLM-based
# prompts/01_plan_execution.md step.
#
# Reads the sprint plan, waves, tasks, and durable state, then emits
# the execution_plan handoff JSON. Zero LLM tokens consumed.
#
# Inputs:  $SPRINT_ID env, $DRY_RUN env (optional, "true"|"false"),
#          $RELAY_HANDOFFS_DIR env (auto-set by relay-core).
# Outputs: writes $RELAY_HANDOFFS_DIR/execution_plan.json (handoff for
#          downstream contextFrom consumers).
# Exit:    0=ok, 1=missing input.

SCRIPT_NAME="plan-execution"
# shellcheck source=../../../../scripts/_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd jq
require_env SPRINT_ID RELAY_HANDOFFS_DIR

sprint_file=".planning/sprints/${SPRINT_ID}.json"
waves_file=".planning/sprints/${SPRINT_ID}.waves.json"
tasks_file=".planning/sprints/${SPRINT_ID}.tasks.json"
state_file=".planning/state/${SPRINT_ID}.json"

[ -f "$sprint_file" ] || die 1 "missing sprint plan: $sprint_file"
[ -f "$waves_file" ]  || die 1 "missing waves file: $waves_file"
[ -f "$tasks_file" ]  || die 1 "missing tasks file: $tasks_file"
[ -f "$state_file" ]  || die 1 "missing state file: $state_file (run load-state first)"

dry_run="${DRY_RUN:-false}"
if [ "$dry_run" != "true" ]; then dry_run="false"; fi

branch=$(jq -r '.branch // ""' "$sprint_file")
feature_brief=$(jq -r '.feature_brief // ""' "$sprint_file")

# Build the waves array with full task objects nested inside each wave.
# Each wave in waves_file has .tasks as an array of task ids; we inflate
# them from tasks_file.
waves_json=$(jq -c --slurpfile tasks "$tasks_file" --slurpfile state "$state_file" '
  ($tasks[0].tasks // []) as $all_tasks
  | ($state[0] // {}) as $st
  | .waves
  | map(
      . as $w
      | {
          id: $w.id,
          kind: $w.kind,
          tasks: [
            $w.tasks[] as $tid
            | $all_tasks[] | select(.id == $tid)
          ],
          token_budget: ($w.token_budget // 200000),
          max_parallelism: ($w.max_parallelism // 4)
        }
    )
' "$waves_file")

# Build the state snapshot.
state_json=$(jq -c '{
  wave_status:    (.wave_status // {}),
  task_status:    (.task_status // {}),
  last_commit_sha: (.last_commit_sha // null),
  in_flight:      (.in_flight // [])
}' "$state_file")

# Determine next_wave_id — first wave whose wave_status != "done".
next_wave_id=$(jq -r --slurpfile state "$state_file" '
  .waves
  | map(select(($state[0].wave_status // {})[.] != "done"))
  | .[0] // null
' "$sprint_file")

# Apply dry_run restrictions per §21.1: keep only the first non-done wave,
# restrict its tasks to the first task, drop the smoke wave.
if [ "$dry_run" = "true" ]; then
  waves_json=$(echo "$waves_json" | jq -c --arg nw "$next_wave_id" '
    map(select(.id == $nw))
    | if length > 0 then
        .[0].tasks = [.[0].tasks[0]]
        | [.[0]]
      else [] end
  ')
fi

# Assemble the execution plan.
plan_json=$(jq -n \
  --arg sprint_id "$SPRINT_ID" \
  --arg branch "$branch" \
  --arg feature_brief "$feature_brief" \
  --argjson waves "$waves_json" \
  --argjson state "$state_json" \
  --arg next_wave_id "$next_wave_id" \
  --argjson dry_run "$dry_run" \
  '{
    sprint_id: $sprint_id,
    branch: $branch,
    feature_brief: $feature_brief,
    waves: $waves,
    state: $state,
    next_wave_id: (if $next_wave_id == "null" or $next_wave_id == "" then null else $next_wave_id end),
    dry_run: $dry_run
  }')

# Write to the handoff directory so downstream steps (retro contextFrom,
# wave-runner env) can read it via the relay handoff store.
mkdir -p "$RELAY_HANDOFFS_DIR"
printf '%s\n' "$plan_json" > "$RELAY_HANDOFFS_DIR/execution_plan.json"
log "wrote execution_plan.json ($(printf '%s' "$plan_json" | wc -c | tr -d ' ') bytes)"

# Also emit to stdout for the artifact.
printf '%s\n' "$plan_json"
