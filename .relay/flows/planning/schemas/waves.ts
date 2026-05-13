import { z } from '@ganderbite/relay-core';
import { WaveSchema } from './wave.js';

/**
 * Output of `prompts/05_compose_waves.md` — the `compose-waves` step.
 *
 * Every entry follows AGENTIC_SDLC.md §5.2; the planner must enforce
 * the wave invariants before emitting (no in-wave dependency cycles,
 * pairwise-disjoint `target_files`, token-budget bound, parallelism
 * cap, contract dependencies satisfied earlier).
 *
 * The final wave must be the smoke wave (`kind: "review"`,
 * `id: "wave-smoke"`) per §10.5.
 */
export const WavesSchema = z.object({
  waves: z
    .array(WaveSchema)
    .min(1)
    .describe('Ordered waves. Last entry is the smoke wave on the final sprint.'),
});

export type Waves = z.infer<typeof WavesSchema>;
