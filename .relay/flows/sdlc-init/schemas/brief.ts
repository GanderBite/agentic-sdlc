import { z } from '@ganderbite/relay-core';

/**
 * Output of `prompts/02_brainstorm.md` — the brainstormer step that
 * turns `start.md` plus the intel snapshot into `docs/APPLICATION_BRIEF.md`.
 *
 * `rounds_used` is bounded to 0..3 (zero when the start brief was already
 * unambiguous). `open_gaps` lists items the brainstormer flagged with
 * `OPEN:` defaults; an empty list means every gap was answered.
 */
export const BriefSchema = z.object({
  brief_path: z
    .string()
    .describe('Path to the application brief markdown, normally `docs/APPLICATION_BRIEF.md`.'),
  rounds_used: z
    .number()
    .int()
    .min(0)
    .max(3)
    .describe(
      'Number of question rounds asked of the human. Hard cap of 3 per the brain-storming skill.',
    ),
  open_gaps: z
    .array(z.string())
    .describe(
      'Gap labels left unanswered after round 3, paired with best-effort defaults in the brief.',
    ),
  summary: z
    .string()
    .describe(
      'One-to-three-sentence restatement of the application, its primary user, and its core use cases.',
    ),
});

export type Brief = z.infer<typeof BriefSchema>;
