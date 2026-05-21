import { defineFlow, step, z } from "@ganderbite/relay-core";
import { WaveOutcomeSchema } from "./schemas/wave-outcome.js";
import { ExecutionPlanSchema } from "./schemas/execution-plan.js";
import { RetroSchema } from "./schemas/retro.js";
import { BuilderAgentsSchema } from "./schemas/builder-agents.js";
import { ReviewOutcomeSchema } from "./schemas/review-outcome.js";
import { FixOutcomeSchema } from "./schemas/fix-outcome.js";

/**
 * sprint-implementation — execute one sprint per AGENTIC_SDLC.md §7.3.
 *
 * The wave step is the load-bearing one. It is a single `step.prompt`
 * running the wave-runner role that fans out builder subagents via
 * `Task`, runs the reviewer, retries failed tasks per `task.on_fail`,
 * and emits `wave_result` including `all_waves_done`.
 *
 * Why one prompt step, not nested Relay structures:
 *   - `step.parallel` is forbidden inside `step.loop`, but a wave fans
 *     out an unknown number of tasks.
 *   - Nested loops are forbidden, but failure handling needs a per-task
 *     retry loop inside the wave.
 *   - Both forms of dynamism live naturally inside Claude Code via
 *     `Task`. Relay sees one step per wave — exactly the granularity
 *     needed for atomic per-wave commits and resumable per-wave
 *     checkpoints.
 *
 * Pre-flight (`scripts/preflight.sh`) runs first per §9.3; failure
 * aborts the sprint before any code is written.
 *
 * Flow inputs (`sprintId`, `repo`, `dryRun`) reach the scripts via the
 * per-step `env` mapping below — relay-core resolves `from: "input.<path>"`
 * at step start and exports the value into the child process as the
 * named env var.
 */
export default defineFlow({
  name: "sprint-implementation",
  version: "0.1.0",
  description:
    "Execute a sprint: branch, run waves with parallel builders + reviewer, commit per wave, retro, open PR.",
  input: z.object({
    sprintId: z
      .string()
      .describe(
        "The sprint to execute, matching `.planning/sprints/<id>.json`.",
      ),
    repo: z.string().describe("GitHub `owner/name` the PR opens against."),
    dryRun: z
      .boolean()
      .default(false)
      .describe(
        "Bootstrap mode (§21.1): wave-loop runs the first wave only, restricted to the first task; smoke wave skipped; PR opens as draft.",
      ),
  }),
  start: "preflight",
  steps: {
    preflight: step.script({
      run: ["bash", "-c", "\"$RELAY_FLOW_DIR/scripts/preflight.sh\""],
      env: {
        SPRINT_ID: { from: "input.sprintId", required: true },
      },
      onFail: "abort",
    }),

    branch: step.script({
      run: ["bash", "-c", "\"$RELAY_FLOW_DIR/scripts/sprint-branch.sh\""],
      dependsOn: ["preflight"],
      env: {
        SPRINT_ID: { from: "input.sprintId", required: true },
      },
      onFail: "abort",
    }),

    "load-state": step.script({
      run: ["bash", "-c", "\"$RELAY_FLOW_DIR/scripts/load-state.sh\""],
      dependsOn: ["branch"],
      env: {
        SPRINT_ID: { from: "input.sprintId", required: true },
      },
      output: { artifact: "state.json" },
      onFail: "abort",
    }),

    "plan-execution": step.prompt({
      promptFile: "prompts/01_plan_execution.md",
      dependsOn: ["load-state"],
      tools: ["Read", "Glob", "Grep"],
      output: { handoff: "execution_plan", schema: ExecutionPlanSchema },
    }),

    "derive-builders": step.prompt({
      promptFile: "prompts/00_derive_builders.md",
      dependsOn: ["plan-execution"],
      tools: ["Read", "Write", "Bash", "Glob"],
      model: "sonnet",
      output: { handoff: "builder_agents", schema: BuilderAgentsSchema },
    }),

    "wave-loop": step.loop({
      dependsOn: ["derive-builders"],
      body: {
        // Deterministic state update BEFORE the wave-runner runs:
        // picks the next non-done wave, flips its tasks → "in_progress".
        // Removes that responsibility from the wave-runner LLM (which
        // previously hallucinated state writes — see the run 45ae1f
        // post-mortem). Pairs with `mark-tasks-done` below.
        "mark-tasks-in-progress": step.script({
          run: ["bash", "-c", "\"$RELAY_FLOW_DIR/scripts/mark-tasks-in-progress.sh\""],
          env: {
            SPRINT_ID: { from: "input.sprintId", required: true },
          },
          onFail: "abort",
        }),

        wave: step.prompt({
          promptFile: "prompts/02_wave.md",
          dependsOn: ["mark-tasks-in-progress"],
          tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task"],
          model: "opus",
          agents: { from: "handoff.builder_agents", required: true },
          output: { handoff: "wave_outcome", schema: WaveOutcomeSchema },
        }),

        "wave-commit": step.script({
          // Inline shell — reads the unified `wave_outcome` handoff and runs
          // `git commit -m subject -m body`. Idempotent: exits 0 without
          // committing when the wave produced no changes (e.g. a no-op
          // review wave). Cross-check: every dispatches[].subagent_type
          // MUST appear in builder_agents.json — fails the commit if the
          // wave-runner reports a phantom or default-`builder` persona, so
          // we catch agent-utilization regressions immediately.
          run: [
            "bash",
            "-c",
            [
              "set -e",
              'outcome="$RELAY_HANDOFFS_DIR/wave-loop/wave_outcome.json"',
              'agents="$RELAY_HANDOFFS_DIR/builder_agents.json"',
              '[ -f "$outcome" ] || { echo "[wave-commit] missing handoff: $outcome" >&2; exit 1; }',
              '[ -f "$agents" ] || { echo "[wave-commit] missing handoff: $agents" >&2; exit 1; }',
              // Cross-check dispatches against registered builder personas.
              'phantom=$(jq -r --slurpfile a "$agents" \'[.dispatches[].subagent_type] - [$a[0][].name] | unique | .[]\' "$outcome")',
              'if [ -n "$phantom" ]; then echo "[wave-commit] phantom subagent_type(s) reported in dispatches[]: $phantom" >&2; echo "[wave-commit] registered personas:" >&2; jq -r ".[].name" "$agents" >&2; exit 1; fi',
              // Idempotency check: nothing to commit → exit clean.
              'if git diff --cached --quiet && git diff --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then echo "[wave-commit] no changes for this wave"; exit 0; fi',
              'subject=$(jq -r .commit_message.subject "$outcome")',
              'body=$(jq -r .commit_message.body "$outcome")',
              'git add -A',
              'if [ -n "$body" ]; then git commit -m "$subject" -m "$body"; else git commit -m "$subject"; fi',
            ].join("; "),
          ],
          dependsOn: ["wave"],
          onFail: "abort",
        }),

        // Pre-smoke (R7 / verification-gates §R10). After the wave commits
        // its diff, run the sprint's terminal smoke gates against HEAD.
        // Catches cumulative drift (TS5097, lint-scope, etc.) in the wave
        // that introduced it, instead of saving the entire backlog for the
        // final `wave-smoke` wave. The gates come from the planner-emitted
        // tasks.json — fully tool-agnostic.
        //
        // Failure exits 2 → the wave-loop body aborts. The next iteration
        // re-enters mark-tasks-in-progress, which resets the wave's tasks
        // to retry. `onFail: "abort"` here is correct — we want the loop
        // to surface the problem immediately, not silently continue.
        "wave-smoke": step.script({
          run: ["bash", "-c", "\"$RELAY_FLOW_DIR/scripts/wave-smoke.sh\""],
          dependsOn: ["wave-commit"],
          env: {
            SPRINT_ID: { from: "input.sprintId", required: true },
          },
          onFail: "abort",
        }),

        // Deterministic state update AFTER the commit lands. Reads the
        // wave_outcome handoff, flips each tasks_done/blocked/failed entry,
        // and if every task in the wave is now terminal, marks the wave
        // itself "done". Pairs with `mark-tasks-in-progress` — together
        // they remove all state-write responsibility from the LLM.
        "mark-tasks-done": step.script({
          run: ["bash", "-c", "\"$RELAY_FLOW_DIR/scripts/mark-tasks-done.sh\""],
          dependsOn: ["wave-smoke"],
          env: {
            SPRINT_ID: { from: "input.sprintId", required: true },
          },
          onFail: "abort",
        }),
      },
      until: { from: "wave_outcome", when: { all_waves_done: true } },
      maxIterations: 20,
    }),

    // Post-wave aggregate code-review-fix loop. The wave-loop already runs
    // a per-wave reviewer, but per §16.1 v1 escalates blocking findings to
    // humans without auto-fixing. This loop closes that gap:
    //   review        — spawn wave-reviewer over the full sprint diff,
    //                   emit review_outcome with `clean` flag. The reviewer
    //                   ingests the previous iteration's gate-replay-iter-*
    //                   file (if any) and turns red gates into synthetic
    //                   `gate_replay_failure` blocking findings — closes G2
    //                   of SPRINT_WORKFLOW_POSTMORTEM.md.
    //   fix-findings  — if not clean, dispatch file-scoped fixer Tasks to
    //                   existing builder personas (reuses builder_agents).
    //                   Auto-fixable findings are mandatory-dispatch
    //                   regardless of severity (verification-gates §R7,
    //                   closes G3).
    //   fix-commit    — commit the fix-pass diff (idempotent + no-op safe).
    //   gate-replay   — re-run the union of every task.verification command
    //                   from the sprint plan against HEAD. Failures land
    //                   in .planning/state/<sprint>/gate-replay-iter-<n>.json,
    //                   which the NEXT iteration's `review` step ingests.
    //                   Generic mechanism, no tool names (verification-gates §R8).
    // Loop exits as soon as review_outcome.clean === true, or after at most
    // 3 iterations. `onFail: "continue"` so an unclean exhaust still flows
    // into retro (which surfaces the unclean state in its narrative).
    "review-fix-loop": step.loop({
      dependsOn: ["wave-loop"],
      body: {
        review: step.prompt({
          promptFile: "prompts/04_review.md",
          tools: ["Read", "Glob", "Grep", "Bash", "Task", "Write"],
          model: "opus",
          agents: { from: "handoff.builder_agents", required: true },
          output: { handoff: "review_outcome", schema: ReviewOutcomeSchema },
        }),

        "fix-findings": step.prompt({
          promptFile: "prompts/05_fix_findings.md",
          dependsOn: ["review"],
          tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task"],
          model: "opus",
          agents: { from: "handoff.builder_agents", required: true },
          output: { handoff: "fix_outcome", schema: FixOutcomeSchema },
        }),

        "fix-commit": step.script({
          run: ["bash", "-c", "\"$RELAY_FLOW_DIR/scripts/fix-commit.sh\""],
          dependsOn: ["fix-findings"],
          onFail: "abort",
        }),

        // Gate replay (verification-gates §R8). Runs the union of every
        // task.verification command from .planning/sprints/<id>.tasks.json
        // against HEAD. Records exit codes to gate-replay-iter-<n>.json.
        // Exits 0 even on gate failure — the next `review` iteration
        // converts red gates into synthetic blocking findings, which the
        // loop's `until` condition (`clean: true`) honors.
        "gate-replay": step.script({
          run: ["bash", "-c", "\"$RELAY_FLOW_DIR/scripts/gate-replay.sh\""],
          dependsOn: ["fix-commit"],
          env: {
            SPRINT_ID: { from: "input.sprintId", required: true },
          },
          onFail: "continue",
        }),
      },
      until: { from: "review_outcome", when: { clean: true } },
      maxIterations: 3,
      onFail: "continue",
    }),

    retro: step.prompt({
      promptFile: "prompts/03_retro.md",
      dependsOn: ["review-fix-loop"],
      contextFrom: [
        "execution_plan",
        "wave-loop.wave_outcome",
        "review-fix-loop.review_outcome",
      ],
      tools: ["Read", "Write", "Bash"],
      model: "opus",
      output: { handoff: "retro", schema: RetroSchema },
    }),

    report: step.script({
      run: ["bash", "-c", "\"$RELAY_FLOW_DIR/scripts/build-report.sh\""],
      dependsOn: ["retro"],
      env: {
        SPRINT_ID: { from: "input.sprintId", required: true },
      },
      output: { artifact: "report.html" },
    }),

    pr: step.script({
      run: ["bash", "-c", "\"$RELAY_FLOW_DIR/scripts/open-pr.sh\""],
      dependsOn: ["report"],
      env: {
        SPRINT_ID: { from: "input.sprintId", required: true },
        REPO: { from: "input.repo", required: true },
        DRY_RUN: { from: "input.dryRun" },
      },
    }),
  },
});
