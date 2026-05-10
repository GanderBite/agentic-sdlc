import { z } from '@ganderbite/relay-core';

/**
 * Output of `prompts/06_prd.md` — the PRD step that commits
 * `docs/PRD.md` describing core features, non-goals, constraints, and a
 * release plan.
 *
 * `v1_features` must contain only feature names the planner can convert
 * into observable verification gates; reviewers cross-check this against
 * `features_count` and the doc body.
 */
export const PrdSchema = z.object({
  prd_path: z
    .string()
    .describe('Path to the committed PRD, normally `docs/PRD.md`.'),
  features_count: z
    .number()
    .int()
    .nonnegative()
    .describe('Total number of features documented across all priority tiers.'),
  v1_features: z
    .array(z.string())
    .describe('Feature names included in the v1 release. Must be `p0` per the PRD body.'),
  open_questions: z
    .array(z.string())
    .describe('Features whose acceptance bullets are not yet observable, deferred to the next planning round.'),
});

export type Prd = z.infer<typeof PrdSchema>;
