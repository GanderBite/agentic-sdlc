import { z } from '@ganderbite/relay-core';

/**
 * Output of `prompts/03_decompose.md` — the discovery flow's final
 * planning artifact. Each entry becomes one `.planning/features/FEATURE-<slug>.md`
 * spec that a downstream `planning` run consumes as its `featureSpec` input.
 *
 * Each feature is sized so the downstream planner produces exactly ONE sprint
 * (target: 5-15 tasks per feature). If a candidate decomposition would yield
 * 30+ tasks for a single feature, split it further at this layer rather than
 * deferring the split to planning.
 */
const FeatureSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: 'slug must be lowercase kebab-case, e.g. "patient-portal"',
    })
    .describe('Stable kebab-case identifier. Filename becomes FEATURE-<slug>.md.'),
  title: z.string().describe('Human-readable feature name.'),
  summary: z
    .string()
    .describe('One-sentence statement of what this feature delivers.'),
  scope: z
    .array(z.string())
    .min(1)
    .describe('Concrete capabilities included in this feature. Each is a short noun phrase.'),
  out_of_scope: z
    .array(z.string())
    .describe('Capabilities explicitly excluded from this feature, deferred to a later feature.'),
  acceptance_bullets: z
    .array(z.string())
    .min(1)
    .describe(
      'Observable acceptance criteria. Every bullet must be covered by ≥1 mechanical verification gate downstream in planning.',
    ),
  primary_users: z
    .array(z.string())
    .min(1)
    .describe('User roles this feature is for. Subset of the application-level primary_users.'),
  depends_on: z
    .array(z.string())
    .describe(
      'Slugs of other features that must ship before this one. Used to sequence multiple planning + sprint-implementation runs.',
    ),
  estimated_task_count: z
    .number()
    .int()
    .min(1)
    .max(25)
    .describe(
      'Coarse estimate (target: 5-15) used to right-size the decomposition. Hard cap at 25 — split further if higher.',
    ),
});

export const FeatureListSchema = z.object({
  features: z
    .array(FeatureSchema)
    .min(1)
    .refine((arr) => new Set(arr.map((f) => f.slug)).size === arr.length, {
      message: 'feature slugs must be unique',
    }),
});

export type FeatureList = z.infer<typeof FeatureListSchema>;
