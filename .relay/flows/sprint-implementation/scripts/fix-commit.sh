#!/usr/bin/env bash
# fix-commit.sh — commit the diff produced by the `fix-findings` step of
# the `review-fix-loop`. Mirrors the inline `wave-commit` step in flow.ts,
# but for fix-pass diffs.
#
# Inputs:  $RELAY_HANDOFFS_DIR env (set by relay).
# Reads:   $RELAY_HANDOFFS_DIR/review-fix-loop/fix_outcome.json
#          $RELAY_HANDOFFS_DIR/builder_agents.json
# Exit:    0 = committed, or short-circuited (no-op iteration or clean tree).
#          1 = missing input / phantom subagent / git failure.
#
# Three short-circuits:
#   1. fix_outcome.no_op === true  → exit 0 without committing
#   2. tree clean (no diff, no untracked) → exit 0 without committing
#   3. phantom subagent_type in dispatches[] → exit 1 (matches wave-commit)

SCRIPT_NAME="fix-commit"
# shellcheck source=../../../../scripts/_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd jq git
require_env RELAY_HANDOFFS_DIR

outcome="$RELAY_HANDOFFS_DIR/review-fix-loop/fix_outcome.json"
agents="$RELAY_HANDOFFS_DIR/builder_agents.json"

[ -f "$outcome" ] || die 1 "missing handoff: $outcome"
[ -f "$agents"  ] || die 1 "missing handoff: $agents"

# 1. No-op short-circuit when the fix-pass had nothing to do (review was clean).
if [ "$(jq -r '.no_op // false' "$outcome")" = "true" ]; then
  log "fix-pass was a no-op (review_outcome.clean was true) — nothing to commit"
  exit 0
fi

# 2. Phantom subagent guard — same invariant as wave-commit.
phantom=$(jq -r --slurpfile a "$agents" \
  '[.dispatches[].subagent_type] - [$a[0][].name] | unique | .[]' "$outcome")
if [ -n "$phantom" ]; then
  log "phantom subagent_type(s) in fix dispatches: $phantom"
  log "registered personas:"
  jq -r '.[].name' "$agents" >&2
  exit 1
fi

# 3. Idempotency: if the fixers wrote nothing (everything skipped, or fixes
#    were already in place), exit clean.
if git diff --cached --quiet && git diff --quiet \
   && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  log "no changes from fix-pass — skipping commit"
  exit 0
fi

subject=$(jq -r '.commit_message.subject // ""' "$outcome")
body=$(jq -r '.commit_message.body // ""' "$outcome")

if [ -z "$subject" ]; then
  die 1 "fix_outcome.commit_message.subject is empty but no_op is false — refusing to commit"
fi

git add -A
if [ -n "$body" ]; then
  git commit -m "$subject" -m "$body"
else
  git commit -m "$subject"
fi

log "committed: $subject"
