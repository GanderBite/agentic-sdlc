import { agentDefinitionSchema, z } from '@ganderbite/relay-core';

/**
 * Output of `prompts/00_derive_builders.md` — the prep step that walks the
 * sprint's tasks, groups them by skill profile, and emits one inline
 * `AgentDefinition` per builder persona.
 *
 * The downstream wave step consumes this via
 * `agents: { from: 'handoff.builder_agents', required: true }`. Each agent's
 * `name` becomes a `subagent_type` the wave-runner can dispatch tasks to via
 * the Task tool. Each agent's `skills` are loaded into the subagent's context
 * by claude-cli's built-in skill loader.
 *
 * Per the design: no `.claude/agents/<name>.md` base files — every persona is
 * fully inline (`systemPrompt` + `skills` + `tools`). Personas are derived
 * per-sprint from the actual task skill mix, so a sprint with no UI tasks
 * will not synthesise a `frontend-builder`.
 */
export const BuilderAgentsSchema = z
  .array(agentDefinitionSchema)
  .min(1)
  .describe(
    'One AgentDefinition per builder persona this sprint needs. Each has inline systemPrompt + skills + tools — no extends.',
  );

export type BuilderAgents = z.infer<typeof BuilderAgentsSchema>;
