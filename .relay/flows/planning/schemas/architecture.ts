import { z } from '@ganderbite/relay-core';

/**
 * Output of `prompts/03_arch.md` — planning's per-feature architecture step.
 *
 * Splits two concerns:
 *
 * 1. **System-level edits** to `docs/ARCHITECTURE.md`. Most features don't
 *    trigger any. When they do (new module added, new policy, new layering
 *    rule), `system_sections_*` capture the diff for the human approve-arch
 *    gate.
 *
 * 2. **Feature-level architecture decision**. Per the design split in the
 *    AGENTIC_SDLC: `sdlc-init` picks the system shape (monolith /
 *    modular-monolith / etc.) — `planning` picks the feature's INTERNAL
 *    structure case-by-case.
 *
 *    - `feature_architecture_decision: "inherit"` — the feature follows the
 *      system architecture as-is. No new file written. `feature_*` fields
 *      are null. Default when in doubt.
 *    - `feature_architecture_decision: "derive"` — the feature warrants its
 *      own pattern. `.planning/features/ARCHITECTURE-<slug>.md` is written
 *      next to `FEATURE-<slug>.md`, and `feature_style` names the chosen
 *      pattern.
 *
 * Downstream `compose-plan` body steps glob both `.enriched.md` and (when
 * present) `ARCHITECTURE-<slug>.md` to ground their `target_files` decisions.
 */
export const ArchitectureSchema = z.object({
  // --- System-level (docs/ARCHITECTURE.md) ---
  system_architecture_path: z
    .string()
    .describe('Path to the system architecture document, normally `docs/ARCHITECTURE.md`.'),
  system_sections_added: z
    .array(z.string())
    .describe(
      'Headings added to docs/ARCHITECTURE.md in this run (e.g. "Modules/<new-module>"). Empty when no system-level change.',
    ),
  system_sections_modified: z
    .array(z.string())
    .describe(
      'Headings modified in place in docs/ARCHITECTURE.md. Empty when no system-level change.',
    ),
  system_diff_summary: z
    .string()
    .min(1)
    .describe(
      'One-or-two-sentence summary of system-level changes (or "no system-level architectural change required for this feature"). Quoted by the human approve-arch gate.',
    ),

  // --- Feature-level (.planning/features/ARCHITECTURE-<slug>.md) ---
  feature_architecture_decision: z
    .enum(['inherit', 'derive'])
    .describe(
      '"inherit" = feature follows the system architecture as-is (no per-feature file written). "derive" = feature has its own internal style; the .planning/features/ARCHITECTURE-<slug>.md file IS written.',
    ),
  feature_architecture_path: z
    .string()
    .nullable()
    .describe(
      'Path to the per-feature architecture file when feature_architecture_decision is "derive"; null otherwise. Format: ".planning/features/ARCHITECTURE-<slug>.md".',
    ),
  feature_style: z
    .string()
    .nullable()
    .describe(
      'The chosen feature-level style when deriving (e.g. "hexagonal", "layered", "transactional-script", "vertical-slice", "event-sourced", "ports-and-adapters", "clean"). Null when inheriting.',
    ),

  // --- Enriched feature spec (always written) ---
  enriched_path: z
    .string()
    .describe(
      'Path to the enriched feature spec, normally `.planning/features/<slug>.enriched.md`. Globbed by downstream compose-plan body steps as the source-of-truth for task composition.',
    ),
});

export type Architecture = z.infer<typeof ArchitectureSchema>;
