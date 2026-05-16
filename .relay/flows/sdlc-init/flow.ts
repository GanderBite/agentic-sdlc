import { defineFlow, step, z } from '@ganderbite/relay-core';
import { IntelSchema } from './schemas/intel.js';
import { BriefSchema } from './schemas/brief.js';
import { BriefQuestionsSchema } from './schemas/brief-questions.js';
import { ArchitectureSchema } from './schemas/architecture.js';
import { TechStackSchema } from './schemas/tech-stack.js';
import { SkillsIndexSchema } from './schemas/skills-index.js';
import { PrdSchema } from './schemas/prd.js';

/**
 * sdlc-init — bootstrap a project per AGENTIC_SDLC.md §7.1.
 *
 * Output: docs/ARCHITECTURE.md, docs/TECH_STACK.md, docs/PRD.md, docs/INTEL.md,
 * populated .claude/skills/, and a single sdlc/init commit.
 *
 * Human gates use relay's native `step.ask` rather than shelling out to a
 * project-supplied script. Each gate either renders a single `confirm`
 * question (the approve-* gates) or sources its question list dynamically
 * from a prior step's handoff (the brainstorm gate).
 *
 * The brainstorm phase is a 2-step structured dialogue:
 *   1. `brief-questions` — an LLM step that emits `Question[]` describing
 *      the blocking gaps in `{{input.startMd}}`.
 *   2. `ask-brief` — relay's `step.ask` reads the questions handoff and
 *      pauses the run for human input. Resume via `relay answer <runId>`.
 *   3. `brainstorm` — synthesises `docs/APPLICATION_BRIEF.md` from the
 *      original brief + the answer map.
 * This replaces the previous single-prompt brainstormer that called a
 * `scripts/ask.sh` shim from inside its Bash tool — relay drives the UI now.
 */
export default defineFlow({
  name: 'sdlc-init',
  version: '0.1.0',
  description:
    'Bootstrap a project: produce ARCHITECTURE.md, TECH_STACK.md, PRD.md, INTEL.md, and the starter skill set.',
  input: z.object({
    repoPath: z
      .string()
      .default('.')
      .describe('Repository root the SDLC scaffolding lands inside.'),
    startMd: z
      .string()
      .optional()
      .describe(
        'Path to the user-supplied initial brief (e.g. "START.md"). The brainstorm prompts read this directly via {{input.startMd}}; leave unset to bootstrap from zero.',
      ),
  }),
  start: 'branch',
  steps: {
    // First step — switch to `sdlc/init` on a clean worktree (or `git init`
    // the repo entirely if this is a brand-new starter directory). Every
    // downstream write lands on a pushable, persistent branch.
    branch: step.script({
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/branch.sh"'],
      onFail: 'abort',
    }),

    intel: step.prompt({
      promptFile: 'prompts/01_intel.md',
      dependsOn: ['branch'],
      tools: ['Read', 'Glob', 'Grep', 'Bash', 'Write'],
      output: { handoff: 'intel', schema: IntelSchema },
    }),

    'verify-intel': step.script({
      // MIN_BYTES is intentionally low: intel emits 8 files, several of
      // which are legitimately tiny (`.snapshot` is a 41-byte git SHA;
      // modules.json / build-graph.json on a fresh repo can be a
      // 2-character `{}` etc.). The gate's real job here is "every
      // claimed file exists and is non-empty" — strict size checks
      // belong on the docs (brief / ARCHITECTURE / TECH_STACK / PRD).
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/assert-handoff-files.sh"'],
      dependsOn: ['intel'],
      env: {
        HANDOFF_NAME: 'intel',
        PATHS_JQ: '.files_written // []',
        MIN_BYTES: '1',
      },
      onFail: 'abort',
    }),

    'brief-questions': step.prompt({
      promptFile: 'prompts/02a_brainstorm_questions.md',
      dependsOn: ['verify-intel'],
      contextFrom: ['intel'],
      tools: ['Read'],
      model: 'opus',
      output: { handoff: 'brief_questions', schema: BriefQuestionsSchema },
    }),

    'ask-brief': step.ask({
      dependsOn: ['brief-questions'],
      questions: { from: 'brief_questions' },
    }),

    brainstorm: step.prompt({
      promptFile: 'prompts/02b_brainstorm_synthesize.md',
      dependsOn: ['ask-brief'],
      contextFrom: ['intel', 'brief_questions', 'ask-brief'],
      tools: ['Read', 'Write'],
      model: 'opus',
      output: { handoff: 'brief', schema: BriefSchema },
    }),

    'verify-brainstorm': step.script({
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/assert-handoff-files.sh"'],
      dependsOn: ['brainstorm'],
      env: {
        HANDOFF_NAME: 'brief',
        PATHS_JQ: '[.brief_path]',
        MIN_BYTES: '1024',
      },
      onFail: 'abort',
    }),

    architecture: step.prompt({
      promptFile: 'prompts/03_architecture.md',
      dependsOn: ['verify-brainstorm'],
      contextFrom: ['brief', 'intel'],
      tools: ['Read', 'Write'],
      model: 'opus',
      output: { handoff: 'architecture', schema: ArchitectureSchema },
    }),

    'verify-architecture': step.script({
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/assert-handoff-files.sh"'],
      dependsOn: ['architecture'],
      env: {
        HANDOFF_NAME: 'architecture',
        PATHS_JQ: '[.architecture_path]',
        MIN_BYTES: '2048',
      },
      onFail: 'abort',
    }),

    'approve-arch': step.ask({
      dependsOn: ['verify-architecture'],
      questions: [
        {
          id: 'approved',
          kind: 'confirm',
          label:
            'Approve docs/ARCHITECTURE.md? Reject to abort the run and revise the prompt or brief.',
          default: true,
        },
      ],
    }),

    'tech-stack': step.prompt({
      promptFile: 'prompts/04_tech_stack.md',
      dependsOn: ['approve-arch'],
      contextFrom: ['architecture', 'brief'],
      tools: ['Read', 'Write'],
      model: 'opus',
      output: { handoff: 'tech_stack', schema: TechStackSchema },
    }),

    'verify-tech-stack': step.script({
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/assert-handoff-files.sh"'],
      dependsOn: ['tech-stack'],
      env: {
        HANDOFF_NAME: 'tech_stack',
        PATHS_JQ: '[.tech_stack_path]',
        MIN_BYTES: '1024',
      },
      onFail: 'abort',
    }),

    'approve-stack': step.ask({
      dependsOn: ['verify-tech-stack'],
      questions: [
        {
          id: 'approved',
          kind: 'confirm',
          label:
            'Approve docs/TECH_STACK.md? Reject to abort the run and revise the architecture or stack picks.',
          default: true,
        },
      ],
    }),

    skills: step.prompt({
      promptFile: 'prompts/05_skills.md',
      dependsOn: ['approve-stack'],
      contextFrom: ['tech_stack'],
      tools: ['Read', 'Write', 'Bash', 'Task'],
      model: 'opus',
      output: { handoff: 'skills_index', schema: SkillsIndexSchema },
      timeoutMs: 1800000,
    }),

    'skill-lint': step.script({
      run: ['bash', '-c', 'node "$RELAY_FLOW_DIR/scripts/skill-linter.mjs"'],
      dependsOn: ['skills'],
      onFail: 'abort',
    }),

    prd: step.prompt({
      promptFile: 'prompts/06_prd.md',
      dependsOn: ['skill-lint'],
      contextFrom: ['brief', 'architecture', 'tech_stack'],
      tools: ['Read', 'Write'],
      model: 'opus',
      output: { handoff: 'prd', schema: PrdSchema },
    }),

    'verify-prd': step.script({
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/assert-handoff-files.sh"'],
      dependsOn: ['prd'],
      env: {
        HANDOFF_NAME: 'prd',
        PATHS_JQ: '[.prd_path]',
        MIN_BYTES: '1024',
      },
      onFail: 'abort',
    }),

    'approve-prd': step.ask({
      dependsOn: ['verify-prd'],
      questions: [
        {
          id: 'approved',
          kind: 'confirm',
          label:
            'Approve docs/PRD.md? Reject to abort the run and revise the prompt or upstream artifacts.',
          default: true,
        },
      ],
    }),

    commit: step.script({
      run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/commit-sdlc-init.sh"'],
      dependsOn: ['approve-prd'],
    }),
  },
});
