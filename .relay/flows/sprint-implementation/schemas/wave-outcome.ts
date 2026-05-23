import { z } from '@ganderbite/relay-core';

/**
 * The unified handoff each wave-loop iteration emits. Combines what used
 * to be three concerns into one trip to the LLM:
 *
 * 1. Wave execution result (former `WaveResultSchema`) — drives the
 *    `until` condition via `all_waves_done`.
 * 2. Commit message (former `WaveCommitMessageSchema`) — consumed by the
 *    inline `wave-commit` step that follows.
 * 3. Agent attribution (`dispatches[]`) — the wave-runner's record of
 *    which subagent persona received which task. The inline `wave-commit`
 *    cross-checks every `subagent_type` against `builder_agents.json`
 *    before committing, surfacing wave-runner cheating (e.g. defaulting
 *    to a generic `builder` instead of dispatching to the matched persona).
 */
export const WaveOutcomeSchema = z.object({
  // ---- wave execution result ----
  wave_id: z.string().describe('The wave just executed.'),
  verdict: z
    .enum(['pass', 'blocked', 'failed', 'partial'])
    .describe('Aggregate verdict over all tasks in the wave.'),
  tasks_done: z.array(z.string()).describe('Task IDs that finished green.'),
  tasks_blocked: z.array(z.string()).describe('Task IDs that escalated per `task.on_fail`.'),
  tasks_failed: z.array(z.string()).describe('Task IDs that exhausted retries with no escalation.'),
  tokens_used_total: z
    .number()
    .describe('Sum of builder + reviewer + orchestrator tokens for this wave.'),
  wall_clock_ms: z.number().int().nonnegative().describe('Wave duration.'),
  all_waves_done: z
    .boolean()
    .describe('True iff there is no next wave. Drives the wave-loop `until` condition.'),
  findings_summary: z
    .object({
      blocking: z.number().int().nonnegative(),
      high: z.number().int().nonnegative(),
      medium: z.number().int().nonnegative(),
      low: z.number().int().nonnegative(),
      info: z.number().int().nonnegative(),
    })
    .describe('Counts from the reviewer audit findings.'),
  next_wave_id: z
    .string()
    .nullable()
    .describe('The wave-id the next iteration will execute, or null on done.'),

  // ---- commit message (consumed by the inline wave-commit step) ----
  commit_message: z
    .object({
      subject: z
        .string()
        .min(1)
        .max(72)
        .describe(
          'Single-line conventional-commits subject. ≤72 chars. Format `<type>(<scope>): wave-<n> — <human description>`. Prefix with `wip(<scope>):` when verdict !== "pass".',
        ),
      body: z
        .string()
        .describe(
          'Multi-line commit body. Empty string allowed for trivial waves. Lines wrap at ~72 chars.',
        ),
    })
    .describe(
      'The commit message the inline wave-commit step runs `git commit -m subject -m body` with.',
    ),

  // ---- agent attribution (auditable record of dispatch decisions) ----
  dispatches: z
    .array(
      z.object({
        task_id: z.string().describe('Task this dispatch handled.'),
        subagent_type: z
          .string()
          .describe(
            'The agent persona name the wave-runner passed to the Task tool. MUST appear in builder_agents.json — wave-commit asserts this before committing.',
          ),
        files_touched: z.array(z.string()).describe('Files the builder reported writing/editing.'),
        attempt: z
          .number()
          .int()
          .min(1)
          .describe('Attempt number for this task (1 on first try, ≥2 on retry).'),
      }),
    )
    .describe(
      'One entry per Task dispatch the wave-runner issued. Used for agent-utilization audit + the wave-commit cross-check.',
    ),
});

export type WaveOutcome = z.infer<typeof WaveOutcomeSchema>;
