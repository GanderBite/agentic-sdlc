import { z } from '@ganderbite/relay-core';

/**
 * Output of `prompts/01_intel.md` — the intel-keeper step that bootstraps
 * `docs/INTEL.md` and `.planning/intel/*` for a new project.
 *
 * `fresh_repo: true` signals downstream brainstorm/architecture steps
 * that they are designing from zero rather than extending an existing
 * codebase. `snapshot_sha` is the literal string "INIT" on a fresh run
 * (no `git rev-parse HEAD` yet) and a real SHA otherwise.
 */
export const IntelSchema = z.object({
  intel_md_path: z
    .string()
    .describe('Path to the top-level INTEL summary, normally `docs/INTEL.md`.'),
  modules_count: z
    .number()
    .int()
    .nonnegative()
    .describe('Number of modules detected. Zero is valid on a brand-new repo.'),
  languages: z
    .array(z.string())
    .describe('Languages detected from source files and manifests, e.g. ["typescript"].'),
  package_manager: z
    .string()
    .describe('Package manager detected from manifests (e.g. "pnpm", "npm", "uv", "go").'),
  test_runner: z
    .string()
    .describe(
      'Test runner derived from manifests (e.g. "vitest", "pytest"). Empty string if none.',
    ),
  fresh_repo: z
    .boolean()
    .describe(
      'True iff the repository had no source files at intel time. Drives downstream defaults.',
    ),
  snapshot_sha: z
    .string()
    .describe(
      'The SHA written to `.planning/intel/.snapshot`. Use "INIT" when there is no commit yet.',
    ),
  files_written: z
    .array(z.string())
    .describe('Every file the intel-keeper wrote this run. Used by reviewers to scope audits.'),
});

export type Intel = z.infer<typeof IntelSchema>;
