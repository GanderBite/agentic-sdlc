import { QuestionsArraySchema } from '@ganderbite/relay-core';

/**
 * Output of `prompts/02a_clarify_questions.md` — one round of biz/tech
 * questions the discovery flow asks the human to enrich a raw app idea.
 *
 * Re-uses the relay-core native `Question[]` union directly so `step.ask`
 * can consume it via `{ questions: { from: 'clarify_questions' } }`.
 *
 * Recommended options are encoded inline as `"X (recommended)"` text in
 * the option string (relay-core's Question schema doesn't carry a
 * dedicated `recommended` field today).
 */
export const ClarifyQuestionsSchema = QuestionsArraySchema;
