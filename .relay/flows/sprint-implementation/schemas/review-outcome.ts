import { z } from '@ganderbite/relay-core';

/**
 * Shared between review and fix outcomes — same shape the wave-runner
 * already uses inside WaveOutcomeSchema.findings_summary.
 */
export const FindingsSummarySchema = z.object({
  blocking: z.number().int().nonnegative(),
  high: z.number().int().nonnegative(),
  medium: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
});

/**
 * Output of `prompts/04_review.md` — the post-wave-loop aggregate reviewer
 * dispatcher. Drives the `review-fix-loop` `until` condition: the loop
 * exits as soon as `clean === true` OR after `maxIterations: 3`.
 *
 * `clean` is intentionally NOT a strict `blocking === 0` gate — we
 * include `high` so security/correctness issues block the loop too, but
 * stop at medium so style/duplication nits don't make the loop spin
 * forever (those land in the retro instead).
 *
 * `findings_path` and `review_path` point at files the wave-reviewer
 * agent wrote under `.planning/state/<sprint>/`. The fix dispatcher
 * reads `findings_path` to decide what to fix.
 */
export const ReviewOutcomeSchema = z.object({
  iteration: z
    .number()
    .int()
    .min(1)
    .max(3)
    .describe('1-based iteration index within the review-fix-loop.'),
  clean: z
    .boolean()
    .describe(
      'True iff findings_summary.blocking === 0 AND findings_summary.high === 0. Drives the until condition.',
    ),
  findings_summary: FindingsSummarySchema,
  findings_path: z
    .string()
    .describe(
      'Path to the aggregate findings file the wave-reviewer wrote, ' +
        'e.g. `.planning/state/<sprint>/findings-review-iter-<n>.json`.',
    ),
  review_path: z
    .string()
    .describe(
      'Path to the aggregate mechanical-review file (§10.1 schema), ' +
        'e.g. `.planning/state/<sprint>/review-review-iter-<n>.json`.',
    ),
  changed_files: z
    .array(z.string())
    .describe(
      'Union of files changed across all sprint commits — output of ' +
        '`git diff <base_sha>..<head_sha> --name-only`, excluding `.planning/state/**`.',
    ),
  base_sha: z.string().describe('SHA the diff was taken against (sprint branch fork point).'),
  head_sha: z.string().describe('HEAD at review time.'),
});

export type ReviewOutcome = z.infer<typeof ReviewOutcomeSchema>;
