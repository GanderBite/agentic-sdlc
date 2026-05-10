import { z } from '@ganderbite/relay-core';

/**
 * Output of `prompts/02_brainstorm.md` — the brainstormer step that
 * produces `.planning/features/<slug>.enriched.md` and surfaces the
 * key fields downstream tasks/waves composition will read.
 *
 * The enriched bullet list must include every original
 * `brief.acceptance_bullets` entry; new clarifications are appended, not
 * substituted. Reviewers cross-check this property in retros.
 */
export const EnrichedBriefSchema = z.object({
  enriched_path: z
    .string()
    .describe('Path to the enriched brief markdown, normally `.planning/features/FEATURE-<slug>.enriched.md`.'),
  rounds_used: z
    .number()
    .int()
    .min(0)
    .max(3)
    .describe('Question rounds asked of the human. Hard cap of 3 per the brain-storming skill.'),
  open_gaps: z
    .array(z.string())
    .describe('Gap labels left unanswered after round 3, paired with best-effort defaults in the enriched brief.'),
  acceptance_bullets: z
    .array(z.string())
    .min(1)
    .describe('Original acceptance bullets plus any clarifications added by the brainstormer.'),
  summary: z.string().describe('One-sentence restatement of what is to be built.'),
});

export type EnrichedBrief = z.infer<typeof EnrichedBriefSchema>;
