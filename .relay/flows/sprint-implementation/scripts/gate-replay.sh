#!/usr/bin/env bash
# gate-replay.sh — body step of the `review-fix-loop`, runs AFTER fix-commit.
#
# Closes G2 of SPRINT_WORKFLOW_POSTMORTEM.md: previously the loop iterated
# on findings text, never on gates. A fixer could break a verification
# command and the loop would still exit `clean: true` because the textual
# findings were resolved. This step takes the union of every task's
# task.verification commands across the sprint plan, dedupes, and re-runs
# them against HEAD. Any non-zero exit forces the loop to keep iterating.
#
# The script is intentionally tool-agnostic — it discovers commands from
# the planner-emitted tasks.json. No tool names appear here.
#
# Inputs:  $SPRINT_ID env, $RELAY_HANDOFFS_DIR env (set by relay).
# Reads:   .planning/sprints/${SPRINT_ID}.tasks.json
#          $RELAY_HANDOFFS_DIR/review-fix-loop/review_outcome.json
#          $RELAY_HANDOFFS_DIR/review-fix-loop/fix_outcome.json
# Writes:  .planning/state/${SPRINT_ID}/gate-replay-iter-<n>.json
# Exit:    0 always — failures are recorded in the JSON output and surfaced
#          via the next `review` iteration (which reads this file and emits
#          synthetic blocking findings). We must not abort the loop here.

SCRIPT_NAME="gate-replay"
# shellcheck source=../../../../scripts/_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd jq git
require_env SPRINT_ID RELAY_HANDOFFS_DIR

tasks_file=".planning/sprints/${SPRINT_ID}.tasks.json"
state_dir=".planning/state/${SPRINT_ID}"
review_outcome="$RELAY_HANDOFFS_DIR/review-fix-loop/review_outcome.json"
fix_outcome="$RELAY_HANDOFFS_DIR/review-fix-loop/fix_outcome.json"

# Defensive: a no-op iteration (review was clean) should not run gates again.
# The wave-loop's per-wave verification already attested the gates were green
# when the wave committed; re-running now would just burn time.
if [ -f "$fix_outcome" ] && [ "$(jq -r '.no_op // false' "$fix_outcome")" = "true" ]; then
  log "fix-outcome was no_op — skipping gate replay (gates were green when wave committed)"
  exit 0
fi

[ -f "$tasks_file" ] || die 1 "missing tasks file: $tasks_file"

iteration="$(jq -r '.iteration // 1' "$review_outcome" 2>/dev/null || echo 1)"
mkdir -p "$state_dir"
out_file="${state_dir}/gate-replay-iter-${iteration}.json"

# Union every task.verification entry, dedupe by (kind, cmd, expect_exit).
# The 5 gate kinds are: tests, lint, build, files_exist, custom — same as
# verification-gates SKILL R1.
mapfile -t gates < <(
  jq -r '
    [
      .tasks // [] | .[] |
      .verification // {} as $v |
      (
        ($v.tests  // [] | map({kind:"tests",       cmd:., expect_exit:0})),
        ($v.lint   // [] | map({kind:"lint",        cmd:., expect_exit:0})),
        ($v.build  // [] | map({kind:"build",       cmd:., expect_exit:0})),
        ($v.files_exist // [] | map({kind:"files_exist", cmd:., expect_exit:0})),
        ($v.custom // [] | map({kind:"custom", cmd:.cmd, expect_exit:(.expect_exit // 0)}))
      ) | .[]
    ]
    | unique_by([.kind, .cmd, .expect_exit])
    | .[] | @json
  ' "$tasks_file"
)

results_json="[]"
any_failure=0

for gate_json in "${gates[@]}"; do
  kind="$(echo "$gate_json"   | jq -r '.kind')"
  cmd="$(echo "$gate_json"    | jq -r '.cmd')"
  expect="$(echo "$gate_json" | jq -r '.expect_exit')"

  start_ms="$(date +%s%3N 2>/dev/null || echo 0)"
  if [ "$kind" = "files_exist" ]; then
    # Pass iff path exists AND is non-empty (verification-gates §R2.3).
    if [ -s "$cmd" ]; then exit_code=0; else exit_code=1; fi
  else
    # One-shot exec; no flake-retry here (those are per-task at wave time).
    bash -c "$cmd" >/dev/null 2>&1 && exit_code=0 || exit_code=$?
  fi
  end_ms="$(date +%s%3N 2>/dev/null || echo 0)"
  duration_ms=$(( end_ms - start_ms ))

  if [ "$exit_code" != "$expect" ]; then
    any_failure=1
    log "FAIL kind=${kind} expect_exit=${expect} got=${exit_code} cmd=${cmd}"
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
  --argjson iteration "$iteration" \
  --arg head_sha "$head_sha" \
  --argjson any_failure "$any_failure" \
  --argjson results "$results_json" \
  '{
    meta: {
      sprint_id: $sprint_id,
      iteration: $iteration,
      head_sha: $head_sha,
      generated_at: (now | todate)
    },
    clean: ($any_failure == 0),
    failure_count: ([$results[] | select(.exit != .expect_exit)] | length),
    gates: $results
  }' | atomic_write "$out_file"

if [ "$any_failure" = "1" ]; then
  log "gate replay FAILED — $(jq -r '.failure_count' "$out_file") gate(s) red on HEAD; written to $out_file"
else
  log "gate replay OK — all $(jq -r '.gates | length' "$out_file") gate(s) green on HEAD"
fi

exit 0
