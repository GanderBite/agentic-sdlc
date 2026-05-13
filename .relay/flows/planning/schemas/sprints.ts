import { z } from '@ganderbite/relay-core';
import { SprintSchema } from './sprint.js';

/**
 * Output of `prompts/06_compose_sprints.md` — the `compose-sprints` step.
 *
 * Each sprint object follows AGENTIC_SDLC.md §5.3. The planner groups
 * waves into sprints by `orchestrator_token_budget`; the smoke wave
 * always lands as the final wave of the final sprint, never split off.
 */
export const SprintsSchema = z.object({
  sprints: z
    .array(SprintSchema)
    .min(1)
    .describe('Ordered sprints derived from the wave list, bounded by orchestrator token budget.'),
});

export type Sprints = z.infer<typeof SprintsSchema>;
