import { z } from '@ganderbite/relay-core';

/**
 * Output of `prompts/01_brief.md` — the `read-brief` step parses an
 * input `FEATURE-*.md` into a structured handoff so downstream steps
 * never re-read the raw markdown.
 *
 * `acceptance_bullets` are preserved verbatim — the planner converts each
 * into ≥1 verification gate (§5.2 coverage rule). Paraphrasing them
 * silently breaks coverage tracking, so the schema requires at least one
 * bullet when the brief is non-empty.
 */
export const BriefSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe('Feature title as written in the brief\'s H1.'),
  summary: z.string().min(1).describe('One paragraph describing what the feature is.'),
  motivation: z.string().describe('Why the feature exists — the user need or constraint driving it.'),
  acceptance_bullets: z
    .array(z.string())
    .describe('Observable acceptance criteria, preserved verbatim from the brief.'),
  non_goals: z
    .array(z.string())
    .describe('Explicit out-of-scope items. Empty when the brief lists none.'),
  references: z
    .array(z.string())
    .describe('Paths to other docs the brief points at (e.g. `docs/ARCHITECTURE.md`).'),
  raw_path: z
    .string()
    .describe('Path passed in as input. Echoed for downstream traceability.'),
});

export type Brief = z.infer<typeof BriefSchema>;
