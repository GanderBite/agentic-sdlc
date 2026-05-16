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
  start: 'branch',
  steps: {
    // First step — switch to `sdlc/discovery` on a clean worktree so every
    // downstream write lands on a pushable, persistent branch (the relay
    // worktree's auto-branch is reaped on completion).
    branch: step.script({
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/branch.sh"'],
      onFail: 'abort',
    }),

    'clarify-questions': step.prompt({
      promptFile: 'prompts/01_clarify_questions.md',
      dependsOn: ['branch'],
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

    // Final step: land outputs on `sdlc/discovery`, push, open a PR.
    // The flow runs in a relay worktree that is reaped on completion, so
    // anything not committed and pushed is lost. Push and PR creation are
    // best-effort: a missing remote or unauthenticated gh logs a warning
    // but doesn't fail the run — the commit itself is the load-bearing
    // bit, the rest is convenience.
    commit: step.script({
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/commit-and-pr.sh"'],
      dependsOn: ['write-feature-specs'],
    }),
  },
});
