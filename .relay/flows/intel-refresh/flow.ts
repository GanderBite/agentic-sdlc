import { defineFlow, step, z } from '@ganderbite/relay-core';
import { DiffReportSchema } from './schemas/diff-report.js';
import { PatchedSchema } from './schemas/patched.js';

/**
 * intel-refresh — diff-only refresh of INTEL.md and .planning/intel/*
 * per AGENTIC_SDLC.md §7.4.
 *
 * Cheap flow that runs the intel-keeper role only. Triggered by humans,
 * by `loop`, by a hook on merge to main, or as the first step of
 * `planning`. The diff step compares `git diff <snapshot>..HEAD --name-only`
 * against `.planning/intel/.snapshot`; the patch step rewrites only the
 * intel files affected by changed source files. A clean diff produces
 * an empty patch.
 */
export default defineFlow({
  name: 'intel-refresh',
  version: '0.1.0',
  description:
    'Diff-only refresh of INTEL.md and .planning/intel/* against the current HEAD.',
  input: z.object({
    full: z
      .boolean()
      .default(false)
      .describe(
        'Force a full rebuild instead of a diff-only refresh (e.g. when .planning/intel/.snapshot is missing or corrupt).',
      ),
  }),
  start: 'diff',
  steps: {
    diff: step.prompt({
      promptFile: 'prompts/01_diff.md',
      tools: ['Read', 'Glob', 'Grep', 'Bash'],
      output: { handoff: 'diff_report', schema: DiffReportSchema },
    }),

    patch: step.prompt({
      promptFile: 'prompts/02_patch.md',
      dependsOn: ['diff'],
      contextFrom: ['diff_report'],
      tools: ['Read', 'Write', 'Edit', 'Bash'],
      output: { handoff: 'patched', schema: PatchedSchema },
    }),
  },
});
