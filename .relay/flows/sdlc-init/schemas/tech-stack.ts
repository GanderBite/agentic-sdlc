import { z } from '@ganderbite/relay-core';

/**
 * Output of `prompts/04_tech_stack.md` — the tech-stack step that pins
 * exactly one tool per slot in `docs/TECH_STACK.md`.
 *
 * `skills_to_author` is the deduplicated list of `.claude/skills/`
 * packages the next step (`skills`) must produce. Every entry must map
 * to a tool actually chosen above; reviewers use this as a checklist.
 */
export const TechStackSchema = z.object({
  tech_stack_path: z
    .string()
    .describe('Path to the committed tech-stack document, normally `docs/TECH_STACK.md`.'),
  languages: z.array(z.string()).min(1).describe('Primary languages chosen for the project.'),
  runtime: z
    .string()
    .describe(
      'Runtime version pin, e.g. "node@22", "python@3.13", "go@1.23". One value, no "either/or".',
    ),
  package_manager: z
    .string()
    .describe('Package manager pinned for the project (e.g. "pnpm", "uv", "go"). One value.'),
  test_runner: z
    .string()
    .describe('Test runner pinned for the project (e.g. "vitest", "pytest"). One value.'),
  linter: z
    .string()
    .describe('Linter pinned for the project (e.g. "biome", "ruff", "golangci-lint"). One value.'),
  skills_to_author: z
    .array(z.string())
    .describe(
      'Skill package names the next step must author. Deduplicated; excludes existing process skills.',
    ),
});

export type TechStack = z.infer<typeof TechStackSchema>;
