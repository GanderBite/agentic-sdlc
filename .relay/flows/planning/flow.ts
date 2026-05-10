import { defineFlow, step, z } from '@ganderbite/relay-core';
import { BriefSchema } from './schemas/brief.js';
import { EnrichedBriefSchema } from './schemas/enriched-brief.js';
import { FeatureQuestionsSchema } from './schemas/feature-questions.js';
import { ArchitectureSchema } from './schemas/architecture.js';
import { TasksSchema } from './schemas/tasks.js';
import { WavesSchema } from './schemas/waves.js';
import { SprintsSchema } from './schemas/sprints.js';
import { CoverageReportSchema } from './schemas/coverage-report.js';

/**
 * planning — decompose a feature brief into tasks/waves/sprint(s) per
 * AGENTIC_SDLC.md §7.2.
 *
 * Input: a feature-brief path under `.planning/features/FEATURE-*.md`.
 * Output: one or more `.planning/sprints/sprint-*.json` files, validated
 * against §19.1 by `scripts/validate-plan.mjs` invoked from
 * `scripts/write-sprint-files.sh`.
 *
 * Compared to the §7.2 sketch, two pieces are restructured to fit relay
 * primitives natively:
 *
 *   - Brainstorm — replaced the single-prompt brainstormer that shelled
 *     out to `scripts/ask.sh` with a 2-step structured dialogue: an LLM
 *     step that emits `Question[]`, then `step.ask` reads it via dynamic
 *     question source, then a synthesise step writes the enriched brief.
 *
 *   - Architecture — dropped the `scripts/needs-architecture.sh` branch
 *     step. Relay's DAG walker does not auto-skip alternate branches, so
 *     a `step.branch` whose onExit routes around a chain (extend-arch →
 *     approve-arch) leaves the alternates `pending` forever and downstream
 *     `compose-tasks` (with `dependsOn: ['approve-arch']`) is starved.
 *     The `architecture` step now always runs and no-ops gracefully when
 *     the brief implies no structural change.
 *
 * `compose-tasks → compose-waves → compose-sprints` are sequential
 * single-output steps because Relay produces one handoff per
 * `step.prompt`; the planner is one logical actor with three sub-stages,
 * which also gives Relay step-level resume granularity.
 */
export default defineFlow({
  name: 'planning',
  version: '0.1.0',
  description:
    'Plan a feature: refresh intel, brainstorm, review architecture, compose tasks/waves/sprints, verify coverage.',
  input: z.object({
    featureBrief: z
      .string()
      .describe('Path to the FEATURE-*.md file under .planning/features/.'),
  }),
  start: 'intel-refresh',
  steps: {
    'intel-refresh': step.script({
      run: 'scripts/intel-refresh.sh',
      onExit: { '0': 'continue', '1': 'continue', default: 'abort' },
    }),

    'read-brief': step.prompt({
      promptFile: 'prompts/01_brief.md',
      dependsOn: ['intel-refresh'],
      tools: ['Read'],
      output: { handoff: 'brief', schema: BriefSchema },
    }),

    'feature-questions': step.prompt({
      promptFile: 'prompts/02a_brainstorm_questions.md',
      dependsOn: ['read-brief'],
      contextFrom: ['brief'],
      tools: ['Read'],
      model: 'opus',
      output: { handoff: 'feature_questions', schema: FeatureQuestionsSchema },
    }),

    'ask-feature': step.ask({
      dependsOn: ['feature-questions'],
      questions: { from: 'feature_questions' },
    }),

    brainstorm: step.prompt({
      promptFile: 'prompts/02b_brainstorm_synthesize.md',
      dependsOn: ['ask-feature'],
      contextFrom: ['brief', 'feature_questions', 'ask-feature'],
      tools: ['Read', 'Write'],
      model: 'opus',
      output: { handoff: 'enriched_brief', schema: EnrichedBriefSchema },
    }),

    architecture: step.prompt({
      promptFile: 'prompts/03_arch.md',
      dependsOn: ['brainstorm'],
      contextFrom: ['enriched_brief'],
      tools: ['Read', 'Write'],
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
            'Approve docs/ARCHITECTURE.md (or its no-op state if no changes were needed)? Reject to abort planning and revise the feature brief.',
          default: true,
        },
      ],
    }),

    'compose-tasks': step.prompt({
      promptFile: 'prompts/04_compose_tasks.md',
      dependsOn: ['approve-arch'],
      contextFrom: ['enriched_brief'],
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
      contextFrom: ['enriched_brief', 'sprints'],
      tools: ['Read'],
      model: 'opus',
      output: { handoff: 'coverage_report', schema: CoverageReportSchema },
    }),

    'write-sprints': step.script({
      run: 'scripts/write-sprint-files.sh',
      dependsOn: ['verify-coverage'],
      onFail: 'abort',
    }),
  },
});
