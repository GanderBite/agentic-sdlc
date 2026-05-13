import { z } from '@ganderbite/relay-core';

/**
 * Output of `prompts/01_diff.md` — the diff step decides which intel
 * files need to be patched without writing anything itself.
 *
 * On `mode: "fresh"` (no `.planning/intel/.snapshot` or `input.full ===
 * true`), every intel file is listed and downstream patch step rebuilds
 * from scratch. On `mode: "diff"`, only files affected by the changed
 * source paths are listed.
 */
export const DiffReportSchema = z.object({
  mode: z
    .enum(['fresh', 'diff'])
    .describe('Whether the patch step should rebuild from scratch or apply a partial update.'),
  snapshot_sha: z
    .string()
    .describe(
      'The SHA recorded in `.planning/intel/.snapshot` at entry. Use the literal "INIT" on a fresh run.',
    ),
  head_sha: z
    .string()
    .describe('The current `git rev-parse HEAD`. Will be written to `.snapshot` after a successful patch.'),
  changed_files: z
    .array(z.string())
    .describe(
      'Source paths returned by `git diff <snapshot>..HEAD --name-only`. Empty on `mode: "fresh"`.',
    ),
  intel_files_to_patch: z
    .array(z.string())
    .describe('Deduplicated paths under `.planning/intel/` (and `docs/INTEL.md`) that the patch step must rewrite.'),
});

export type DiffReport = z.infer<typeof DiffReportSchema>;
