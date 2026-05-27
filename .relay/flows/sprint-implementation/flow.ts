import { defineFlow, step, z } from '@ganderbite/relay-core';
import { BuilderAgentsSchema } from './schemas/builder-agents.js';
import { ExecutionPlanSchema } from './schemas/execution-plan.js';
import { FixOutcomeSchema } from './schemas/fix-outcome.js';
import { RetroSchema } from './schemas/retro.js';
import { ReviewOutcomeSchema } from './schemas/review-outcome.js';
import { WaveOutcomeSchema } from './schemas/wave-outcome.js';

/**
 * sprint-implementation — execute one sprint per AGENTIC_SDLC.md §7.3.
 *
 * Performance-optimized flow (v0.2.0):
 *   - plan-execution and derive-builders are deterministic scripts (no LLM).
 *   - Wave-runner and review-fix-loop orchestrators use sonnet (not opus).
 *     Builder subagents still use whatever model the task specifies.
 *   - Per-wave reviewer skipped for non-terminal waves (aggregate
 *     review-fix-loop handles it).
 *   - wave-smoke only runs on the last build wave and wave-smoke itself.
 *   - review-fix-loop capped at 2 iterations (was 3).
 *   - gate-replay runs verification commands in parallel.
 */
export default defineFlow({
  name: 'sprint-implementation',
  version: '0.2.0',
  description:
    'Execute a sprint: branch, run waves with parallel builders + reviewer, commit per wave, retro, open PR.',
  input: z.object({
    sprintId: z.string().describe('The sprint to execute, matching `.planning/sprints/<id>.json`.'),
    repo: z.string().describe('GitHub `owner/name` the PR opens against.'),
    dryRun: z
      .boolean()
      .default(false)
      .describe(
        'Bootstrap mode (§21.1): wave-loop runs the first wave only, restricted to the first task; smoke wave skipped; PR opens as draft.',
      ),
  }),
  start: 'preflight',
  steps: {
    preflight: step.script({
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/preflight.sh"'],
      env: {
        SPRINT_ID: { from: 'input.sprintId', required: true },
      },
      onFail: 'abort',
    }),

    branch: step.script({
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/sprint-branch.sh"'],
      dependsOn: ['preflight'],
      env: {
        SPRINT_ID: { from: 'input.sprintId', required: true },
      },
      onFail: 'abort',
    }),

    'load-state': step.script({
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/load-state.sh"'],
      dependsOn: ['branch'],
      env: {
        SPRINT_ID: { from: 'input.sprintId', required: true },
      },
      output: { artifact: 'state.json' },
      onFail: 'abort',
    }),

    // J: Deterministic script replaces LLM prompt — zero tokens, ~1s.
    'plan-execution': step.script({
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/plan-execution.sh"'],
      dependsOn: ['load-state'],
      env: {
        SPRINT_ID: { from: 'input.sprintId', required: true },
        DRY_RUN: { from: 'input.dryRun' },
      },
      output: { artifact: 'execution_plan.json' },
      onFail: 'abort',
    }),

    // K: Deterministic script replaces LLM prompt — zero tokens, ~1s.
    'derive-builders': step.script({
      run: ['node', '"$RELAY_FLOW_DIR/scripts/derive-builders.mjs"'],
      dependsOn: ['plan-execution'],
      env: {
        SPRINT_ID: { from: 'input.sprintId', required: true },
      },
      output: { artifact: 'builder_agents.json' },
      onFail: 'abort',
    }),

    'wave-loop': step.loop({
      dependsOn: ['derive-builders'],
      body: {
        'mark-tasks-in-progress': step.script({
          run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/mark-tasks-in-progress.sh"'],
          env: {
            SPRINT_ID: { from: 'input.sprintId', required: true },
          },
          onFail: 'abort',
        }),

        // F: Wave-runner downgraded from opus → sonnet. It orchestrates
        // (reads state, dispatches Tasks, processes returns) but never
        // writes code. Builder subagents still use per-task model.
        wave: step.prompt({
          promptFile: 'prompts/02_wave.md',
          dependsOn: ['mark-tasks-in-progress'],
          tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task'],
          model: 'sonnet',
          agents: { from: 'handoff.builder_agents', required: true },
          output: { handoff: 'wave_outcome', schema: WaveOutcomeSchema },
        }),

        'wave-commit': step.script({
          run: [
            'bash',
            '-c',
            [
              'set -e',
              'outcome="$RELAY_HANDOFFS_DIR/wave-loop/wave_outcome.json"',
              'agents="$RELAY_HANDOFFS_DIR/builder_agents.json"',
              '[ -f "$outcome" ] || { echo "[wave-commit] missing handoff: $outcome" >&2; exit 1; }',
              '[ -f "$agents" ] || { echo "[wave-commit] missing handoff: $agents" >&2; exit 1; }',
              'phantom=$(jq -r --slurpfile a "$agents" \'[.dispatches[].subagent_type] - [$a[0][].name] | unique | .[]\' "$outcome")',
              'if [ -n "$phantom" ]; then echo "[wave-commit] phantom subagent_type(s) reported in dispatches[]: $phantom" >&2; echo "[wave-commit] registered personas:" >&2; jq -r ".[].name" "$agents" >&2; exit 1; fi',
              'if git diff --cached --quiet && git diff --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then echo "[wave-commit] no changes for this wave"; exit 0; fi',
              'subject=$(jq -r .commit_message.subject "$outcome")',
              'body=$(jq -r .commit_message.body "$outcome")',
              'git add -A',
              'if [ -n "$body" ]; then git commit -m "$subject" -m "$body"; else git commit -m "$subject"; fi',
            ].join('; '),
          ],
          dependsOn: ['wave'],
          onFail: 'abort',
        }),

        // I: wave-smoke only runs on the last build wave and wave-smoke
        // itself. Early waves skip it — the code is incomplete and
        // intermediate failures are expected. The script now checks
        // whether this is the penultimate or terminal wave.
        'wave-smoke': step.script({
          run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/wave-smoke.sh"'],
          dependsOn: ['wave-commit'],
          env: {
            SPRINT_ID: { from: 'input.sprintId', required: true },
          },
        }),

        'mark-tasks-done': step.script({
          run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/mark-tasks-done.sh"'],
          dependsOn: ['wave-smoke'],
          env: {
            SPRINT_ID: { from: 'input.sprintId', required: true },
          },
          onFail: 'abort',
        }),
      },
      until: { from: 'wave_outcome', when: { all_waves_done: true } },
      maxIterations: 20,
    }),

    // Post-wave aggregate review-fix loop.
    // D: maxIterations reduced from 3 → 2. If 2 iterations don't clean
    // it, human review is more cost-effective than a third LLM pass.
    // A: review + fix-findings orchestrators downgraded from opus → sonnet.
    'review-fix-loop': step.loop({
      dependsOn: ['wave-loop'],
      body: {
        review: step.prompt({
          promptFile: 'prompts/04_review.md',
          tools: ['Read', 'Glob', 'Grep', 'Bash', 'Task', 'Write'],
          model: 'sonnet',
          agents: { from: 'handoff.builder_agents', required: true },
          output: { handoff: 'review_outcome', schema: ReviewOutcomeSchema },
        }),

        'fix-findings': step.prompt({
          promptFile: 'prompts/05_fix_findings.md',
          dependsOn: ['review'],
          tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task'],
          model: 'sonnet',
          agents: { from: 'handoff.builder_agents', required: true },
          output: { handoff: 'fix_outcome', schema: FixOutcomeSchema },
        }),

        'fix-commit': step.script({
          run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/fix-commit.sh"'],
          dependsOn: ['fix-findings'],
          onFail: 'abort',
        }),

        'gate-replay': step.script({
          run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/gate-replay.sh"'],
          dependsOn: ['fix-commit'],
          env: {
            SPRINT_ID: { from: 'input.sprintId', required: true },
          },
          onFail: 'continue',
        }),
      },
      until: { from: 'review_outcome', when: { clean: true } },
      maxIterations: 2,
      onFail: 'continue',
    }),

    // execution_plan is now a script-produced artifact (not a handoff), so
    // the retro reads it from disk via its tools. wave_outcome and
    // review_outcome are still loop handoffs and threaded via contextFrom.
    retro: step.prompt({
      promptFile: 'prompts/03_retro.md',
      dependsOn: ['review-fix-loop'],
      contextFrom: ['wave-loop.wave_outcome', 'review-fix-loop.review_outcome'],
      tools: ['Read', 'Write', 'Bash'],
      model: 'sonnet',
      output: { handoff: 'retro', schema: RetroSchema },
    }),

    report: step.script({
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/build-report.sh"'],
      dependsOn: ['retro'],
      env: {
        SPRINT_ID: { from: 'input.sprintId', required: true },
      },
      output: { artifact: 'report.html' },
    }),

    pr: step.script({
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/open-pr.sh"'],
      dependsOn: ['report'],
      env: {
        SPRINT_ID: { from: 'input.sprintId', required: true },
        REPO: { from: 'input.repo', required: true },
        DRY_RUN: { from: 'input.dryRun' },
      },
    }),
  },
});
