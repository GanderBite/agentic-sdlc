import { QuestionsArraySchema } from '@ganderbite/relay-core';

/**
 * Output of `prompts/01_clarify_questions.md` — one round of clarification
 * questions emitted from a per-feature spec (`FEATURE-<slug>.md`).
 *
 * Re-uses relay-core's native `Question[]` union directly so `step.ask` can
 * consume it via `{ questions: { from: 'clarify_questions' } }`.
 *
 * Recommended options are encoded inline as `"X (recommended)"` text in the
 * option string (relay-core's Question schema doesn't carry a dedicated
 * `recommended` field today).
 */
export const ClarifyQuestionsSchema = QuestionsArraySchema;
