import { z } from '@ganderbite/relay-core';

/**
 * The Task object per AGENTIC_SDLC.md §5.1. Used as a sub-schema by the
 * `tasks` handoff and (in summarised form) wherever a downstream step
 * needs to reference task identity, scope, or verification.
 *
 * Field semantics live in §5.1; the most important runtime invariants:
 *   - `target_files.{create,update,remove}` are advisory expected scope.
 *   - `may_also_touch` is excluded from the §5.2 wave disjointness check.
 *   - `verification` commands must exist in `.planning/intel/build-graph.json`.
 *   - `skills` names must exist in `.claude/skills/INDEX.json` (max 4).
 *   - `model` per task — `opus` for cross-cutting, `haiku` for mechanical.
 */
const TargetFilesSchema = z.object({
  create: z
    .array(z.string())
    .describe('Files the task is expected to create.'),
  update: z
    .array(z.string())
    .describe('Files the task is expected to update.'),
  remove: z
    .array(z.string())
    .describe('Files the task is expected to delete.'),
  may_also_touch: z
    .array(z.string())
    .describe(
      'Pre-blessed files (e.g. re-export indexes) the builder may edit without warning. Excluded from wave disjointness check.',
    ),
});

const VerificationCustomSchema = z.object({
  cmd: z.string().describe('Shell command run by the reviewer.'),
  expect_exit: z
    .number()
    .int()
    .describe('Required exit code for the gate to pass. Use `--quiet` for `rg` invocations.'),
});

const VerificationSchema = z.object({
  tests: z.array(z.string()).describe('Test commands. Sourced from `build-graph.json` per-module or global.'),
  lint: z.array(z.string()).describe('Lint commands. Sourced from `build-graph.json`.'),
  build: z.array(z.string()).describe('Build commands. Empty when the change is test-only.'),
  files_exist: z
    .array(z.string())
    .describe('Paths that must exist after the task runs. Includes `target_files.create`.'),
  custom: z.array(VerificationCustomSchema).describe('Literal-symbol checks; used sparingly.'),
});

export const TaskSchema = z.object({
  id: z
    .string()
    .regex(/^task-[a-z0-9]+(?:-[a-z0-9]+)*$/i)
    .describe('Stable id starting with `task-` followed by one or more `[a-z0-9]+` segments joined by `-`. Examples: `task-7f2a`, `task-api-skel`, `task-doctor-profile`.'),
  title: z.string().describe('Human-readable summary, one sentence.'),
  description: z.string().describe('Detailed prose telling the builder what to do.'),
  context: z
    .array(z.string())
    .describe('References to `INTEL.md` / `ARCHITECTURE.md` sections relevant to this task.'),
  references: z
    .array(z.string())
    .describe('Concrete file paths the builder should read on entry.'),
  target_files: TargetFilesSchema.describe(
    'Expected scope buckets used by the §5.2 wave disjointness check (excluding `may_also_touch`).',
  ),
  verification: VerificationSchema.describe(
    'Mechanical gates the reviewer runs. Replaces prose acceptance criteria.',
  ),
  skills: z
    .array(z.string())
    .max(4)
    .describe('Skill names from `.claude/skills/INDEX.json`. Hard cap of 4 keeps builder context lean.'),
  model: z
    .enum(['opus', 'sonnet', 'haiku'])
    .describe('Per-task model: `opus` for cross-cutting/architectural, `haiku` for mechanical, `sonnet` default.'),
  estimate_tokens: z
    .number()
    .int()
    .positive()
    .describe('Token estimate adjusted by `estimation_priors.json` multipliers (§5.5).'),
  depends_on: z
    .array(z.string())
    .describe('Task ids this task depends on. Must NOT contain other ids inside the same wave (§5.2 invariant 1).'),
  depends_on_contracts: z
    .array(z.string())
    .describe('Contract ids this task consumes. Usually empty in v1; see §5.4.'),
  max_attempts: z
    .number()
    .int()
    .min(1)
    .describe('Retry envelope for the builder (§9). Typically 1 or 2.'),
  on_fail: z
    .enum(['escalate', 'skip'])
    .describe('Policy after `max_attempts` is reached. `escalate` blocks the wave; `skip` continues.'),
  status: z
    .enum(['todo', 'in_progress', 'done', 'blocked', 'failed'])
    .describe('Lifecycle status. `todo` at planning time; runtime mutates this in `.planning/state/*`.'),
  attempts: z
    .array(z.unknown())
    .describe('Runtime log appended by the wave-runner; empty at planning time.'),
  actuals: z
    .union([
      z.null(),
      z.object({
        tokens_used: z.number().int().nonnegative(),
        wall_clock_ms: z.number().int().nonnegative(),
        files_touched: z.array(z.string()),
        verification_results: z.array(z.unknown()),
      }),
    ])
    .describe('Runtime totals filled at sprint end; null at planning time. Drives retros (§11.2).'),
});

export type Task = z.infer<typeof TaskSchema>;
