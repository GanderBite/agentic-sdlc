import { z } from '@ganderbite/relay-core';

/**
 * The Wave object per AGENTIC_SDLC.md §5.2.
 *
 * Wave invariants the planner must enforce before emitting:
 *   1. No task references another task in the same wave via `depends_on`.
 *   2. `target_files` (create + update + remove) are pairwise disjoint.
 *   3. Sum of `estimate_tokens` ≤ `token_budget`.
 *   4. Concurrent builders ≤ `max_parallelism`.
 *   5. All `depends_on_contracts` are satisfied by an earlier wave.
 *
 * `kind: "review"` waves contain exactly one task that invokes the
 * reviewer (the smoke wave is the canonical example).
 */
export const WaveSchema = z.object({
  id: z
    .string()
    .regex(/^wave-[a-z0-9-]+$/i)
    .describe('Stable id of the form `wave-<n>` or a labelled id like `wave-smoke`.'),
  kind: z
    .enum(['build', 'contract', 'review', 'integration'])
    .describe(
      'Wave kind. `contract` waves emit shared interface stubs; `review` waves run the reviewer.',
    ),
  tasks: z
    .array(z.string())
    .min(1)
    .describe(
      'Task ids assigned to this wave. References must resolve in the parent `tasks` handoff.',
    ),
  token_budget: z
    .number()
    .int()
    .positive()
    .describe('Upper bound for the sum of task `estimate_tokens` in the wave.'),
  max_parallelism: z
    .number()
    .int()
    .min(1)
    .max(8)
    .describe('Maximum concurrent builders. Default 4; lower for hot-file waves; never above 8.'),
  status: z
    .enum(['todo', 'in_progress', 'done', 'blocked', 'failed'])
    .describe('Lifecycle status. `todo` at planning time.'),
});

export type Wave = z.infer<typeof WaveSchema>;
