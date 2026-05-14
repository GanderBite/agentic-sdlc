import { defineFlow, step, z } from '@ganderbite/relay-core';
import { ClarifyQuestionsSchema } from './schemas/clarify-questions.js';
import { FeatureListSchema } from './schemas/feature-list.js';

/**
 * discovery — enrich a raw application idea via biz/tech Q&A, then
 * decompose it into per-feature specs that downstream `planning` runs
 * consume one at a time.
 *
 * Input: `appIdea` (path to a raw idea markdown, default `docs/APPLICATION.md`).
 * Output: `.planning/features/FEATURE-<slug>.md` per feature + an
 *         `.planning/features/INDEX.json` listing slugs in execution order.
 *
 * Lifecycle position: runs AFTER `sdlc-init` (which produces ARCHITECTURE.md,
 * TECH_STACK.md, PRD.md, INTEL.md, skills). The discovery flow consumes those
 * docs as context and produces the feature breakdown that drives N sequential
 * `planning` + `sprint-implementation` invocations.
 *
 * The clarify phase is a single round (relay-core 0.7.0 does not yet support
 * cumulative multi-round ask without per-iteration handoff bookkeeping). If a
 * future relay-core release exposes cumulative iteration handoffs, this becomes
 * a 1-to-3-round `step.loop`.
 */
export default defineFlow({
  name: 'discovery',
  version: '0.1.0',
  description:
    'Discover features: enrich a raw application idea via biz/tech questions and decompose it into per-feature specs.',
  input: z.object({
    appIdea: z
      .string()
      .default('docs/APPLICATION.md')
      .describe('Path to the raw application idea markdown.'),
  }),
  start: 'clarify-questions',
  steps: {
    'clarify-questions': step.prompt({
      promptFile: 'prompts/01_clarify_questions.md',
      tools: ['Read', 'Glob'],
      model: 'opus',
      output: { handoff: 'clarify_questions', schema: ClarifyQuestionsSchema },
    }),

    'ask-clarify': step.ask({
      dependsOn: ['clarify-questions'],
      questions: { from: 'clarify_questions' },
    }),

    decompose: step.prompt({
      promptFile: 'prompts/02_decompose.md',
      dependsOn: ['ask-clarify'],
      contextFrom: ['ask-clarify'],
      tools: ['Read', 'Glob', 'Grep'],
      model: 'opus',
      output: { handoff: 'feature_list', schema: FeatureListSchema },
    }),

    'write-feature-specs': step.script({
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/write-feature-specs.sh"'],
      dependsOn: ['decompose'],
      onFail: 'abort',
    }),
  },
});
