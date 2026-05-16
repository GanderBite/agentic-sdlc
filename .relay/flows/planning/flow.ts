import { defineFlow, step, z } from '@ganderbite/relay-core';
import { ClarifyQuestionsSchema } from './schemas/clarify-questions.js';
import { ArchitectureSchema } from './schemas/architecture.js';
import { TasksSchema } from './schemas/tasks.js';
import { WavesSchema } from './schemas/waves.js';
import { SprintsSchema } from './schemas/sprints.js';
import { CoverageReportSchema } from './schemas/coverage-report.js';

/**
 * planning — turn a single feature spec into exactly one sprint plan.
 *
 * Input: `featureSpec` (path to `.planning/features/FEATURE-<slug>.md`,
 *        produced upstream by the `discovery` flow). One planning run
 *        produces one sprint — discovery's per-feature decomposition is
 *        what keeps each sprint small.
 *
 * Output: one `.planning/sprints/sprint-<id>.json` (+ sibling tasks/waves/
 *         coverage files), validated against §19.1 by `scripts/validate-plan.mjs`
 *         invoked from `scripts/write-sprint-files.sh`.
 *
 * Pipeline position:
 *   sdlc-init → discovery → planning (× N features) → sprint-implementation
 *
 * The clarify phase is two steps (`clarify-questions` + `ask-clarify`)
 * replacing the previous three-step brainstormer (feature-questions +
 * ask-feature + brainstorm). The synthesise step is folded into
 * `architecture`, which writes `.planning/features/<slug>.enriched.md`
 * — the file the `compose-plan` body globs.
 *
 * The `compose-plan` loop iterates compose-tasks → compose-waves →
 * compose-sprints → verify-coverage until verify-coverage emits
 * `verdict: "pass"` (max 3 iterations). Each body iteration re-reads the
 * enriched feature spec from disk; the loop's isolation means body steps
 * cannot `contextFrom` outer-flow handoffs directly.
 */
export default defineFlow({
  name: 'planning',
  version: '0.2.0',
  description:
    'Plan ONE feature: refresh intel, clarify gaps with the human, review architecture, compose tasks/waves/one-sprint, verify coverage.',
  input: z.object({
    featureSpec: z
      .string()
      .describe(
        'Path to a FEATURE-<slug>.md spec under .planning/features/ produced by the discovery flow.',
      ),
  }),
  start: 'branch',
  steps: {
    // First step — switch to `sdlc/plan-<feature-slug>` on a clean worktree
    // so every downstream write lands on a pushable, persistent branch.
    // The slug is derived from input.featureSpec by branch.sh.
    branch: step.script({
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/branch.sh"'],
      env: {
        FEATURE_SPEC: { from: 'input.featureSpec', required: true },
      },
      onFail: 'abort',
    }),

    'intel-refresh': step.script({
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/intel-refresh.sh"'],
      dependsOn: ['branch'],
      onExit: { '0': 'continue', '1': 'continue', default: 'abort' },
    }),

    'clarify-questions': step.prompt({
      promptFile: 'prompts/01_clarify_questions.md',
      dependsOn: ['intel-refresh'],
      tools: ['Read', 'Glob'],
      model: 'opus',
      output: { handoff: 'clarify_questions', schema: ClarifyQuestionsSchema },
    }),

    'ask-clarify': step.ask({
      dependsOn: ['clarify-questions'],
      questions: { from: 'clarify_questions' },
    }),

    architecture: step.prompt({
      promptFile: 'prompts/03_arch.md',
      dependsOn: ['ask-clarify'],
      contextFrom: ['ask-clarify'],
      tools: ['Read', 'Write', 'Edit'],
      model: 'opus',
      output: { handoff: 'architecture', schema: ArchitectureSchema },
    }),

    'approve-arch': step.ask({
      dependsOn: ['architecture'],
      questions: [
        {
          id: 'approved',
          kind: 'confirm',
          label:
            'Approve docs/ARCHITECTURE.md (or its no-op state if no changes were needed)? Reject to abort planning and revise the feature spec or clarifications.',
          default: true,
        },
      ],
    }),

    'compose-plan': step.loop({
      dependsOn: ['approve-arch'],
      body: {
        'compose-tasks': step.prompt({
          promptFile: 'prompts/04_compose_tasks.md',
          tools: ['Read', 'Glob', 'Grep'],
          model: 'opus',
          output: { handoff: 'tasks', schema: TasksSchema },
        }),

        'compose-waves': step.prompt({
          promptFile: 'prompts/05_compose_waves.md',
          dependsOn: ['compose-tasks'],
          contextFrom: ['tasks'],
          tools: ['Read'],
          model: 'opus',
          output: { handoff: 'waves', schema: WavesSchema },
        }),

        'compose-sprints': step.prompt({
          promptFile: 'prompts/06_compose_sprints.md',
          dependsOn: ['compose-waves'],
          contextFrom: ['tasks', 'waves'],
          tools: ['Read'],
          model: 'opus',
          output: { handoff: 'sprints', schema: SprintsSchema },
        }),

        'verify-coverage': step.prompt({
          promptFile: 'prompts/07_verify.md',
          dependsOn: ['compose-sprints'],
          contextFrom: ['sprints'],
          tools: ['Read', 'Glob'],
          model: 'opus',
          output: { handoff: 'coverage_report', schema: CoverageReportSchema },
        }),
      },
      until: { from: 'coverage_report', when: { verdict: 'pass' } },
      maxIterations: 3,
      start: 'compose-tasks',
    }),

    'write-sprints': step.script({
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/write-sprint-files.sh"'],
      dependsOn: ['compose-plan'],
      env: {
        HANDOFFS_PREFIX: 'compose-plan',
      },
      onFail: 'abort',
    }),

    // Final step: land outputs on `sdlc/plan-<sprintId>`, push, open a PR.
    // The flow runs in a relay worktree that is reaped on completion, so
    // anything not committed and pushed is lost. Push and PR creation are
    // best-effort and won't abort the run.
    commit: step.script({
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/commit-and-pr.sh"'],
      dependsOn: ['write-sprints'],
    }),
  },
});
