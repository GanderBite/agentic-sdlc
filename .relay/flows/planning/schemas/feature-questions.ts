import { QuestionsArraySchema } from '@ganderbite/relay-core';

/**
 * Output of `prompts/02a_brainstorm_questions.md` — the planning
 * brainstormer's question-planning step. The handoff is a `Question[]`
 * (the relay-core native question union), consumed directly by the
 * downstream `step.ask({ questions: { from: 'feature_questions' } })`.
 *
 * Re-exported here so `flow.ts` can wire it as the step's output schema
 * without re-deriving the relay-core import path inside the flow file.
 */
export const FeatureQuestionsSchema = QuestionsArraySchema;
