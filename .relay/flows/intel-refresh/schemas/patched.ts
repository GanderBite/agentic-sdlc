import { z } from '@ganderbite/relay-core';

/**
 * Output of `prompts/02_patch.md` — the patch step rewrites the intel
 * files listed in the diff report and updates `.planning/intel/.snapshot`.
 *
 * `noop: true` is the steady state when nothing in the working tree
 * affects intel since the last snapshot. Callers (e.g. the planning
 * flow's `intel-refresh` script step) read this to decide whether
 * downstream work must re-run.
 */
export const PatchedSchema = z.object({
  mode: z
    .enum(['fresh', 'diff'])
    .describe('Mirrors `diff_report.mode`; the patch step does not change strategy mid-run.'),
  updated_files: z
    .array(z.string())
    .describe(
      'Files actually written this run, including `.planning/intel/.snapshot` when bumped.',
    ),
  snapshot_sha: z
    .string()
    .describe(
      'The HEAD SHA written to `.planning/intel/.snapshot`. Matches `diff_report.head_sha` on success.',
    ),
  noop: z
    .boolean()
    .describe(
      'True iff nothing was written (clean diff, no patch needed). `updated_files` is empty when true.',
    ),
});

export type Patched = z.infer<typeof PatchedSchema>;
