import { z } from '@ganderbite/relay-core';

/**
 * Output of `prompts/03_retro.md` — the retro step that emits both
 * `.planning/retros/<sprint>.md` (human narrative) and
 * `.planning/retros/<sprint>.priors-patch.json` (machine patch per §11.2).
 *
 * The patch is the only mechanism by which the planner improves between
 * sprints; `scripts/merge-priors.mjs` folds it into
 * `.planning/estimation_priors.json` deterministically after PR merge.
 * Reviewers never write the priors file directly.
 */
export const RetroSchema = z.object({
  retro_md_path: z
    .string()
    .describe(
      'Path to the human-readable retro markdown, normally `.planning/retros/<sprint>.md`.',
    ),
  priors_patch_path: z
    .string()
    .describe(
      'Path to the machine-readable priors patch JSON, normally `.planning/retros/<sprint>.priors-patch.json`.',
    ),
  tasks_summarized: z
    .number()
    .int()
    .nonnegative()
    .describe('Number of tasks whose actuals fed into the patch accumulators.'),
  blocked_tasks: z
    .array(z.string())
    .describe(
      'Task ids that ended `blocked` or `failed`. Each must have a diagnostic file under `.planning/blocked/<sprint>/`.',
    ),
  wave_invariant_hints_added: z
    .number()
    .int()
    .nonnegative()
    .describe('Number of `wave_invariant_hints_add` entries appended to the patch this run.'),
});

export type Retro = z.infer<typeof RetroSchema>;
