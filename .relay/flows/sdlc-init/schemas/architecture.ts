import { z } from '@ganderbite/relay-core';

/**
 * Output of `prompts/03_architecture.md` — the architecture step that
 * commits `docs/ARCHITECTURE.md` for the freshly-bootstrapped project.
 *
 * `style` and `primary_datastore` are pinned enums so downstream tech-stack
 * picks (and reviewer audits) can branch on them without re-parsing the
 * markdown. `open_questions` lists structural questions intentionally
 * deferred to a later sprint's `extend-arch` step.
 */
export const ArchitectureSchema = z.object({
  architecture_path: z
    .string()
    .describe('Path to the committed architecture document, normally `docs/ARCHITECTURE.md`.'),
  style: z
    .enum(['monolith', 'modular-monolith', 'service-oriented', 'serverless'])
    .describe(
      'The chosen architecture style. Reject premature complexity unless the brief requires it.',
    ),
  primary_datastore: z
    .enum(['postgres', 'sqlite', 'mysql', 'dynamodb', 'none', 'other'])
    .describe(
      'Primary datastore. "none" for stateless services; "other" only with a justification in the doc.',
    ),
  decisions_count: z
    .number()
    .int()
    .nonnegative()
    .describe('Number of explicit architectural decisions captured in the document.'),
  open_questions: z
    .array(z.string())
    .describe('Structural questions deferred to a future architecture extension.'),
});

export type Architecture = z.infer<typeof ArchitectureSchema>;
