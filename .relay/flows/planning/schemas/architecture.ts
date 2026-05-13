import { z } from '@ganderbite/relay-core';

/**
 * Output of `prompts/03_arch.md` — the `extend-arch` step that edits
 * `docs/ARCHITECTURE.md` in place to cover the new feature.
 *
 * Distinct from `sdlc-init/schemas/architecture.ts` (which captures
 * the initial architecture decisions). This schema captures the diff
 * the human approver will see in the subsequent `approve-arch` gate.
 */
export const ArchitectureSchema = z.object({
  architecture_path: z
    .string()
    .describe('Path to the edited architecture document, normally `docs/ARCHITECTURE.md`.'),
  sections_added: z
    .array(z.string())
    .describe('Section headings added in this edit (e.g. "Modules/<new-module>").'),
  sections_modified: z
    .array(z.string())
    .describe('Section headings modified in place. Empty when the edit only adds.'),
  diff_summary: z
    .string()
    .min(1)
    .describe('One-or-two-sentence prose summary of what changed and why; quoted by the human gate.'),
  enriched_path: z
    .string()
    .describe(
      'Path to the enriched feature spec the step wrote, normally `.planning/features/<slug>.enriched.md`. Globbed by downstream compose-plan body steps.',
    ),
});

export type Architecture = z.infer<typeof ArchitectureSchema>;
