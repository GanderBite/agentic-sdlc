import { z } from '@ganderbite/relay-core';

/**
 * Output of `prompts/02c_synthesize.md` — the synthesised, clarified app
 * idea after up to three rounds of biz/tech Q&A. Drives the downstream
 * `decompose` step which splits this into per-feature specs.
 */
export const ClarifiedIdeaSchema = z.object({
  title: z.string().describe('Short product name or working title.'),
  summary: z
    .string()
    .describe('Two-to-four sentence description of what the application does and for whom.'),
  primary_users: z
    .array(z.string())
    .min(1)
    .describe('Distinct user roles (e.g. "patient", "doctor", "admin").'),
  business_goals: z
    .array(z.string())
    .min(1)
    .describe('Concrete business outcomes the app must deliver. Each is one sentence, observable.'),
  technical_constraints: z
    .array(z.string())
    .describe(
      'Hard technical constraints (stack pins, deployment target, data residency, scale targets, latency). May be empty if none surfaced.',
    ),
  out_of_scope: z
    .array(z.string())
    .describe('Items explicitly excluded from v1, to prevent scope creep when planning features.'),
  open_questions: z
    .array(z.string())
    .describe(
      'Gaps that remained unanswered after the question rounds, with best-effort defaults baked into business_goals where applicable.',
    ),
  rounds_used: z
    .number()
    .int()
    .min(0)
    .max(3)
    .describe('Question rounds asked of the human. Hard cap of 3.'),
});

export type ClarifiedIdea = z.infer<typeof ClarifiedIdeaSchema>;
