import { z } from '@ganderbite/relay-core';

/**
 * Output of `prompts/07_verify.md` — the `verify-coverage` gate.
 *
 * Maps every `enriched_brief.acceptance_bullets` entry to the task ids
 * that cover it and the verification gates those tasks cite. A bullet
 * with zero gates appears in `gaps` and forces `verdict: "fail"`, which
 * `scripts/write-sprint-files.sh` honours by refusing to write.
 *
 * Mechanical gates are the only proof of coverage — prose review does
 * not count.
 */
const CoverageEntrySchema = z.object({
  bullet: z.string().describe('The acceptance bullet, verbatim from the enriched brief.'),
  task_ids: z
    .array(z.string())
    .min(1)
    .describe('Task ids that cover the bullet via at least one mechanical gate.'),
  gates: z
    .array(z.string())
    .min(1)
    .describe('Verification gate commands cited by the covering tasks.'),
});

const GapEntrySchema = z.object({
  bullet: z
    .string()
    .describe('Acceptance bullet with zero gate coverage. Surfaces a planner mistake to the human.'),
  reason: z
    .string()
    .optional()
    .describe('Optional explanation for why coverage is missing (e.g. "no matching test command").'),
});

export const CoverageReportSchema = z.object({
  verdict: z
    .enum(['pass', 'fail'])
    .describe('`fail` iff `gaps.length > 0`. `write-sprint-files.sh` will not write on fail.'),
  bullets_total: z
    .number()
    .int()
    .nonnegative()
    .describe('Total acceptance bullets across the enriched brief.'),
  bullets_covered: z
    .number()
    .int()
    .nonnegative()
    .describe('Number of bullets with ≥1 gate. Always ≤ `bullets_total`.'),
  coverage: z.array(CoverageEntrySchema).describe('Per-bullet coverage entries; empty when verdict is `fail`.'),
  gaps: z
    .array(GapEntrySchema)
    .describe('Bullets without gate coverage. Empty on `verdict: "pass"`.'),
});

export type CoverageReport = z.infer<typeof CoverageReportSchema>;
