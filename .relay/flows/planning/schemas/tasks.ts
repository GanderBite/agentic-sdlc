import { z } from '@ganderbite/relay-core';
import { TaskSchema } from './task.js';

/**
 * Output of `prompts/04_compose_tasks.md` — the `compose-tasks` step.
 *
 * Each task object follows AGENTIC_SDLC.md §5.1; see `./task.ts` for
 * field semantics. Downstream `compose-waves` reads this list and
 * groups task ids into waves while enforcing the §5.2 invariants.
 */
export const TasksSchema = z.object({
  tasks: z
    .array(TaskSchema)
    .min(1)
    .describe('Tasks composed from the enriched brief. Every entry follows the §5.1 schema.'),
});

export type Tasks = z.infer<typeof TasksSchema>;
