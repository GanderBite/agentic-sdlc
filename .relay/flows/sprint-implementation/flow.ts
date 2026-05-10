import { defineFlow, step, z } from '@ganderbite/relay-core';
import { WaveResultSchema } from './schemas/wave-result.js';
import { ExecutionPlanSchema } from './schemas/execution-plan.js';
import { RetroSchema } from './schemas/retro.js';

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
  name: 'sprint-implementation',
  version: '0.1.0',
  description:
    'Execute a sprint: branch, run waves with parallel builders + reviewer, commit per wave, retro, open PR.',
  input: z.object({
    sprintId: z
      .string()
      .describe(
        'The sprint to execute, matching `.planning/sprints/<id>.json`.',
      ),
    repo: z
      .string()
      .describe('GitHub `owner/name` the PR opens against.'),
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
      run: 'scripts/preflight.sh',
      env: {
        SPRINT_ID: { from: 'input.sprintId', required: true },
      },
      onFail: 'abort',
    }),

    branch: step.script({
      run: 'scripts/sprint-branch.sh',
      dependsOn: ['preflight'],
      env: {
        SPRINT_ID: { from: 'input.sprintId', required: true },
      },
      onFail: 'abort',
    }),

    'load-state': step.script({
      run: 'scripts/load-state.sh',
      dependsOn: ['branch'],
      env: {
        SPRINT_ID: { from: 'input.sprintId', required: true },
      },
      output: { artifact: 'state.json' },
      onFail: 'abort',
    }),

    'plan-execution': step.prompt({
      promptFile: 'prompts/01_plan_execution.md',
      dependsOn: ['load-state'],
      tools: ['Read', 'Glob', 'Grep'],
      output: { handoff: 'execution_plan', schema: ExecutionPlanSchema },
    }),

    'wave-loop': step.loop({
      dependsOn: ['plan-execution'],
      body: {
        wave: step.prompt({
          promptFile: 'prompts/02_wave.md',
          tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task'],
          model: 'opus',
          output: { handoff: 'wave_result', schema: WaveResultSchema },
        }),
        'wave-commit': step.script({
          run: 'scripts/wave-commit.sh',
          dependsOn: ['wave'],
          env: {
            SPRINT_ID: { from: 'input.sprintId', required: true },
            WAVE_ID: { from: 'handoff.wave_result.wave_id', required: true },
          },
          onFail: 'abort',
        }),
      },
      until: { from: 'wave_result', when: { all_waves_done: true } },
      maxIterations: 20,
    }),

    retro: step.prompt({
      promptFile: 'prompts/03_retro.md',
      dependsOn: ['wave-loop'],
      contextFrom: ['execution_plan', 'wave-loop.wave_result'],
      tools: ['Read', 'Write', 'Bash'],
      model: 'opus',
      output: { handoff: 'retro', schema: RetroSchema },
    }),

    report: step.script({
      run: 'scripts/build-report.sh',
      dependsOn: ['retro'],
      env: {
        SPRINT_ID: { from: 'input.sprintId', required: true },
      },
      output: { artifact: 'report.html' },
    }),

    pr: step.script({
      run: 'scripts/open-pr.sh',
      dependsOn: ['report'],
      env: {
        SPRINT_ID: { from: 'input.sprintId', required: true },
        REPO: { from: 'input.repo', required: true },
        DRY_RUN: { from: 'input.dryRun' },
      },
    }),
  },
});
