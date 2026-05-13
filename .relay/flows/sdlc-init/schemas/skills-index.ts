import { z } from '@ganderbite/relay-core';

/**
 * Output of `prompts/05_skills.md` — the skills step that fans out
 * `Task(subagent_type="skill-author")` calls for every entry in
 * `tech_stack.skills_to_author` not already present in
 * `.claude/skills/INDEX.json`.
 *
 * `skills_failed` should normally be empty after the orchestrator's
 * single-skill retry; non-empty surfaces a hard failure to the
 * downstream `skill-lint` script step.
 */
export const SkillsIndexSchema = z.object({
  index_path: z
    .string()
    .describe('Path to the skill registry, normally `.claude/skills/INDEX.json`.'),
  skills_authored: z
    .array(z.string())
    .describe('Skill names freshly written by `skill-author` Task children this run.'),
  skills_skipped_existing: z
    .array(z.string())
    .describe('Skill names already present in `INDEX.json` and reused without rewriting.'),
  skills_failed: z
    .array(z.string())
    .describe('Skill names that failed even after the single-skill retry. Empty on a clean run.'),
});

export type SkillsIndex = z.infer<typeof SkillsIndexSchema>;
