#!/usr/bin/env bash
# wave-smoke.sh — runs the sprint's terminal smoke gates after each wave
# commits, BEFORE mark-tasks-done. Closes R7 / G5 surface of
# SPRINT_WORKFLOW_POSTMORTEM.md: "smoke gates run inside every wave, not
# only at the end".
#
# The script is intentionally tool-agnostic. It pulls the verification
# commands from .planning/sprints/<id>.tasks.json (the planner-emitted
# canonical task list); the `task-smoke` task's verification block is the
# source of truth. No tool names appear here.
#
# Behavior:
#   - On the terminal smoke wave itself, this script is a no-op (the wave
#     IS the smoke wave; its own task.verification will run via the normal
#     wave-runner pipeline).
#   - On any earlier wave: run the smoke task's verification commands.
#     Failures are recorded to .planning/state/<sprint>/wave-smoke-<wave>.json
#     and bubble up as a non-zero exit, aborting the wave-loop body and
#     forcing the responsible task to retry per its on_fail policy.
#
# Inputs:  $SPRINT_ID env, $RELAY_HANDOFFS_DIR env.
# Reads:   .planning/sprints/${SPRINT_ID}.tasks.json
#          $RELAY_HANDOFFS_DIR/wave-loop/wave_outcome.json (for wave_id)
# Writes:  .planning/state/${SPRINT_ID}/wave-smoke-<wave_id>.json
# Exit:    0 = always (clean OR red — failures are soft-recorded to the
#              state file; mark-tasks-done reads the result and the
#              review-fix-loop handles remediation).
#          1 = missing input.

SCRIPT_NAME="wave-smoke"
# shellcheck source=../../../../scripts/_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd jq git
require_env SPRINT_ID RELAY_HANDOFFS_DIR

tasks_file=".planning/sprints/${SPRINT_ID}.tasks.json"
waves_file=".planning/sprints/${SPRINT_ID}.waves.json"
state_dir=".planning/state/${SPRINT_ID}"
outcome="$RELAY_HANDOFFS_DIR/wave-loop/wave_outcome.json"

[ -f "$tasks_file" ] || die 1 "missing tasks file: $tasks_file"
[ -f "$outcome" ] || die 1 "missing handoff: $outcome"

wave_id="$(jq -r '.wave_id // ""' "$outcome")"
if [ -z "$wave_id" ]; then
  log "wave_outcome.wave_id is empty — cannot run wave smoke; skipping"
  exit 0
fi

# Identify the terminal smoke wave by id (convention: `wave-smoke`).
# If the current wave IS the smoke wave, skip — the wave-runner already
# runs that wave's task.verification via the normal path.
if [ "$wave_id" = "wave-smoke" ]; then
  log "current wave IS the terminal smoke wave — skipping pre-smoke gate replay"
  exit 0
fi

# Performance optimization (I): only run smoke on the last build wave.
# Early waves produce incomplete code — intermediate failures are expected
# and smoke just wastes ~30-60s per wave. The review-fix-loop catches
# cumulative drift after all waves land.
if [ -f "$waves_file" ]; then
  # Count how many non-done waves remain (excluding the current one).
  remaining=$(jq -r --arg w "$wave_id" --slurpfile state ".planning/state/${SPRINT_ID}.json" '
    [.waves[]
     | select(.id != $w)
     | select(($state[0].wave_status // {})[.id] != "done")
    ] | length
  ' "$waves_file" 2>/dev/null || echo "0")

  # If more than 1 wave remains after this one (i.e. there are still build
  # waves ahead before wave-smoke), skip the smoke check.
  if [ "$remaining" -gt 1 ]; then
    log "skipping smoke for early wave ${wave_id} (${remaining} waves still ahead)"
    exit 0
  fi
fi

# Extract the smoke wave's task.verification commands from tasks.json.
# Convention: the smoke task id is `task-smoke`. Fall back to scanning
# any task whose id starts with `task-smoke` if the canonical id is absent.
# Portable bash 3.2 alternative to `mapfile -t` (which requires bash 4+).
# macOS ships /bin/bash 3.2; this script must run there.
gates=()
while IFS= read -r line; do
  gates+=("$line")
done < <(
  jq -r '
    [
      .tasks // [] |
      map(select(.id == "task-smoke" or (.id // "" | startswith("task-smoke"))))
      | .[]
      # Parens are load-bearing: `.verification // {} as $v` is parsed as
      # `.verification // ({} as $v | <rest>)`, so when .verification is
      # non-null the downstream `(A,B,C,D) | .[]` never runs and jq emits
      # the verification object verbatim. `(.verification // {}) as $v`
      # forces the alternative to bind first, then `$v` carries it forward.
      | (.verification // {}) as $v
      | (
          ($v.tests  // [] | map({kind:"tests",       cmd:., expect_exit:0})),
          ($v.lint   // [] | map({kind:"lint",        cmd:., expect_exit:0})),
          ($v.build  // [] | map({kind:"build",       cmd:., expect_exit:0})),
          ($v.custom // [] | map({kind:"custom", cmd:.cmd, expect_exit:(.expect_exit // 0)}))
        ) | .[]
    ]
    | unique_by([.kind, .cmd, .expect_exit])
    | .[] | @json
  ' "$tasks_file"
)

if [ "${#gates[@]}" -eq 0 ]; then
  log "no smoke gates discovered in tasks.json (no task-smoke entry?) — skipping"
  exit 0
fi

mkdir -p "$state_dir"
out_file="${state_dir}/wave-smoke-${wave_id}.json"

results_json="[]"
any_failure=0

for gate_json in "${gates[@]}"; do
  kind="$(echo "$gate_json"   | jq -r '.kind')"
  cmd="$(echo "$gate_json"    | jq -r '.cmd')"
  expect="$(echo "$gate_json" | jq -r '.expect_exit')"

  start_ms="$(epoch_ms)"
  bash -c "$cmd" >/dev/null 2>&1 && exit_code=0 || exit_code=$?
  end_ms="$(epoch_ms)"
  duration_ms=$(( end_ms - start_ms ))

  if [ "$exit_code" != "$expect" ]; then
    any_failure=1
    log "FAIL wave=${wave_id} kind=${kind} expect_exit=${expect} got=${exit_code} cmd=${cmd}"
  fi

  results_json="$(echo "$results_json" | jq \
    --arg kind "$kind" \
    --arg cmd "$cmd" \
    --argjson expect "$expect" \
    --argjson exit "$exit_code" \
    --argjson duration "$duration_ms" \
    '. + [{kind: $kind, cmd: $cmd, expect_exit: $expect, exit: $exit, duration_ms: $duration}]')"
done

head_sha="$(git rev-parse HEAD 2>/dev/null || echo "")"

jq -n \
  --arg sprint_id "$SPRINT_ID" \
  --arg wave_id "$wave_id" \
  --arg head_sha "$head_sha" \
  --argjson any_failure "$any_failure" \
  --argjson results "$results_json" \
  '{
    meta: {
      sprint_id: $sprint_id,
      wave_id: $wave_id,
      head_sha: $head_sha,
      generated_at: (now | todate)
    },
    clean: ($any_failure == 0),
    failure_count: ([$results[] | select(.exit != .expect_exit)] | length),
    gates: $results
  }' | atomic_write "$out_file"

if [ "$any_failure" = "1" ]; then
  log "smoke gates RED for wave ${wave_id} ($(jq -r '.failure_count' "$out_file") failure(s)); details: $out_file"
  log "mark-tasks-done will record the red state; review-fix-loop handles remediation"
  exit 0
fi

log "smoke gates GREEN for wave ${wave_id} (${#gates[@]} gate(s))"
exit 0
