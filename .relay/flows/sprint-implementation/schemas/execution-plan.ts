import { z } from '@ganderbite/relay-core';

/**
 * Output of `prompts/01_plan_execution.md` — the load-and-plan step that
 * reads `.planning/sprints/<id>.json` and `.planning/state/<id>.json`,
 * cross-checks them, and emits a single execution plan that the
 * wave-loop body consumes.
 *
 * Tasks are nested by full content because the wave-runner needs every
 * task field at fan-out time (target_files, verification, skills,
 * model, on_fail). The schema is intentionally lenient on individual
 * task fields — the canonical Task schema is owned by the planning
 * flow; this flow only requires the fields the wave-runner actually
 * branches on.
 */
const TaskSummarySchema = z
  .object({
    id: z.string().describe('Task id; matches an entry in `task_status`.'),
    title: z.string().describe('Human-readable task title for logging and PR body composition.'),
    target_files: z
      .object({
        create: z.array(z.string()),
        update: z.array(z.string()),
        remove: z.array(z.string()),
        may_also_touch: z.array(z.string()),
      })
      .describe('Scope buckets used to validate wave-time disjointness.'),
    verification: z
      .object({
        tests: z.array(z.string()),
        lint: z.array(z.string()),
        build: z.array(z.string()),
        files_exist: z.array(z.string()),
        custom: z.array(z.unknown()),
      })
      .describe('Mechanical gates the reviewer runs after builders return.'),
    skills: z.array(z.string()).describe('Skill names the builder must Read on entry.'),
    model: z.enum(['opus', 'sonnet', 'haiku']).describe('Per-task model override for the spawned builder.'),
    estimate_tokens: z.number().int().positive().describe('Token estimate; informs budget enforcement.'),
    depends_on: z.array(z.string()).describe('Task ids that must complete before this task is dispatched.'),
    depends_on_contracts: z.array(z.string()).describe('Contract ids consumed; usually empty in v1 (§5.4).'),
    max_attempts: z.number().int().min(1),
    on_fail: z.enum(['escalate', 'skip']),
  })
  .loose();

const WavePlanSchema = z.object({
  id: z.string().describe('Wave id matching an entry in `state.wave_status`.'),
  kind: z.enum(['build', 'contract', 'review', 'integration']),
  tasks: z
    .array(TaskSummarySchema)
    .min(1)
    .describe('Full task content the wave-runner needs at fan-out time.'),
  token_budget: z.number().int().positive(),
  max_parallelism: z.number().int().min(1).max(8),
});

const StateSnapshotSchema = z.object({
  wave_status: z
    .record(z.string(), z.enum(['todo', 'in_progress', 'done', 'blocked', 'failed']))
    .describe('Per-wave lifecycle status loaded from `.planning/state/<sprint>.json`.'),
  task_status: z
    .record(z.string(), z.enum(['todo', 'in_progress', 'done', 'blocked', 'failed']))
    .describe('Per-task lifecycle status loaded from `.planning/state/<sprint>.json`.'),
  last_commit_sha: z
    .union([z.string(), z.null()])
    .describe('SHA of the most recent wave-commit; null on a fresh sprint.'),
  in_flight: z
    .array(z.unknown())
    .describe('Tasks recorded as in-flight at load time. Wave-runner resets these at entry.'),
});

export const ExecutionPlanSchema = z.object({
  sprint_id: z.string().describe('Sprint id from `--sprint`; matches `.planning/sprints/<id>.json`.'),
  branch: z.string().describe('Sprint branch name created by `scripts/sprint-branch.sh`.'),
  feature_brief: z.string().describe('Path to the enriched feature brief used by the planner.'),
  waves: z
    .array(WavePlanSchema)
    .min(1)
    .describe('Ordered waves the wave-loop will iterate over (skipping ones already done).'),
  state: StateSnapshotSchema.describe('Snapshot of `.planning/state/<sprint>.json` at load time.'),
  next_wave_id: z
    .union([z.string(), z.null()])
    .describe('First wave the wave-loop should attempt. Null only when every wave is already done.'),
  dry_run: z
    .boolean()
    .describe(
      'Echoes `input.dryRun`. When true, the wave-loop runs only the first wave restricted to its first task (§21.1).',
    ),
});

export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;
