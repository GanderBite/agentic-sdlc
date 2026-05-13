import { z } from '@ganderbite/relay-core';

/**
 * The Sprint object per AGENTIC_SDLC.md §5.3.
 *
 * `orchestrator_token_budget` bounds sprint size — when it would be
 * exceeded, the planner splits the work into multiple sprints rather
 * than a single mega-sprint. The last wave of the last sprint must be
 * the smoke wave per §10.5.
 */
export const SprintSchema = z.object({
  id: z
    .string()
    .regex(/^sprint-[a-z0-9-]+$/i)
    .describe('Stable id of the form `sprint-<NNN>` claimed via `scripts/reserve-sprint-id.sh`.'),
  title: z.string().describe('Human-readable sprint title, one sentence.'),
  feature_brief: z
    .string()
    .describe('Path to the enriched feature brief used as input. Same value across all tasks in the sprint.'),
  branch: z
    .string()
    .describe('Sprint branch name, conventionally `sprint/<id>-<slug>` (§12).'),
  waves: z
    .array(z.string())
    .min(1)
    .describe('Ordered list of wave ids in this sprint. Must end with the smoke wave on the final sprint.'),
  orchestrator_token_budget: z
    .number()
    .int()
    .positive()
    .describe('Bound on the wave-runner orchestrator’s context across the sprint (§15.1).'),
  status: z
    .enum(['todo', 'in_progress', 'done', 'blocked', 'failed'])
    .describe('Lifecycle status. `todo` at planning time.'),
  created_at: z
    .string()
    .datetime()
    .describe('ISO-8601 timestamp when the sprint plan was composed.'),
  started_at: z
    .union([z.string().datetime(), z.null()])
    .describe('ISO-8601 timestamp when sprint execution began. Null until the first wave runs.'),
  completed_at: z
    .union([z.string().datetime(), z.null()])
    .describe('ISO-8601 timestamp when sprint execution ended. Null until the smoke wave passes.'),
});

export type Sprint = z.infer<typeof SprintSchema>;
