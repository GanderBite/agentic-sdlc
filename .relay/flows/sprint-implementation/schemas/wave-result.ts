import { z } from '@ganderbite/relay-core';

/**
 * The handoff every iteration of the wave-loop body emits. The Relay
 * `until` condition matches against `all_waves_done: true` to terminate
 * the loop. See AGENTIC_SDLC.md §22 for the full schema.
 */
export const WaveResultSchema = z.object({
  wave_id: z.string().describe('The wave just executed.'),
  verdict: z
    .enum(['pass', 'blocked', 'failed', 'partial'])
    .describe('Aggregate verdict over all tasks in the wave.'),
  tasks_done: z.array(z.string()).describe('Task IDs that finished green.'),
  tasks_blocked: z
    .array(z.string())
    .describe('Task IDs that escalated per `task.on_fail`.'),
  tasks_failed: z
    .array(z.string())
    .describe('Task IDs that exhausted retries with no escalation.'),
  tokens_used_total: z
    .number()
    .describe('Sum of builder + reviewer + orchestrator tokens for this wave.'),
  wall_clock_ms: z.number().int().nonnegative().describe('Wave duration.'),
  all_waves_done: z
    .boolean()
    .describe(
      'True iff there is no next wave. Drives the wave-loop `until` condition.',
    ),
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
});

export type WaveResult = z.infer<typeof WaveResultSchema>;
