import { z } from '@ganderbite/relay-core';

/**
 * Output of `prompts/05_fix_findings.md` — the fixer dispatcher inside
 * the `review-fix-loop`. Consumed by the inline `fix-commit` script,
 * which:
 *   1. Short-circuits when `no_op === true` (the upstream review was
 *      already clean — nothing to fix this iteration).
 *   2. Cross-checks every `dispatches[].subagent_type` against
 *      `builder_agents.json` (same invariant as wave-commit).
 *   3. Commits the fix-pass diff with `commit_message`.
 *
 * Fixer dispatches reuse the existing builder personas from
 * `builder_agents.json` — no new persona scaffolding needed. Persona
 * selection follows the same skill-overlap rule as the wave-runner
 * (`prompts/02_wave.md` §4), with pseudo-skills derived from file paths.
 */
export const FixOutcomeSchema = z.object({
  iteration: z.number().int().min(1).max(3).describe('Echoes review_outcome.iteration.'),
  no_op: z
    .boolean()
    .describe(
      'True when the upstream review_outcome.clean was true; nothing was ' +
        'dispatched and the commit script will exit 0 without committing.',
    ),
  findings_addressed: z
    .array(z.string())
    .describe('Finding ids (`F-\\d+`) the fixers claim to have resolved.'),
  findings_skipped: z
    .array(z.string())
    .describe(
      'Finding ids the fix-pass intentionally did not touch (reason in ' +
        'the matching dispatches[].notes).',
    ),
  dispatches: z
    .array(
      z.object({
        subagent_type: z
          .string()
          .describe(
            'Persona name from builder_agents.json. fix-commit cross-checks before committing.',
          ),
        finding_ids: z.array(z.string()).min(1),
        files_touched: z
          .array(z.string())
          .describe(
            'Files this fixer wrote/edited. MUST be a subset of the union of ' +
              "the assigned findings' `file` fields (file-scoped invariant).",
          ),
        notes: z.string().describe('One-line summary of what the fixer did or why it skipped.'),
      }),
    )
    .describe('One entry per fixer Task dispatched. Empty when no_op is true.'),
  commit_message: z
    .object({
      subject: z
        .string()
        .min(0)
        .max(72)
        .describe(
          'Conventional commit subject `fix(<scope>): review-iter-<n> — fix <k> finding(s)`. ' +
            'Empty string when no_op is true (fix-commit short-circuits).',
        ),
      body: z.string().describe('Multi-line body. Empty string allowed.'),
    })
    .describe('Commit message the fix-commit script runs git commit with.'),
});

export type FixOutcome = z.infer<typeof FixOutcomeSchema>;
