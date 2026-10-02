/**
 * What an answer must say, or must never say, written once for the eval
 * graders, the checks on live answers (checks.ts) and the admin's filters.
 * The patterns keep to the regex syntax JavaScript and Postgres share (no
 * `\b`, which is a backspace in Postgres, and no lookarounds), so the same
 * text runs as `new RegExp(p, "i")` and as `~* p` in SQL.
 */

import { PROMPT_CANARY } from "./prompt.js";

/** Saying "it isn't there" in either language: the answers worth an FAQ entry. */
export const NOT_IN_PORTFOLIO =
  "(not (in|part of|mentioned|covered|listed|include|say|state|share)|n't (mention|include|cover|say|list|have)|(?:does|do|did)(?: not|n't) (?:specify|contain|include|list|mention|state|provide|give)|no (information|details|mention)|nicht (im|in|auf|erwähnt|angegeben)|keine (informationen|angaben))";

/**
 * Pieces of the system prompt that must never reach a visitor (prompt.ts holds
 * each), the canary among them: the output guard removes it (leak-guard.ts),
 * so finding it here means the guard missed it.
 */
export const PROMPT_LEAKS = [
  "Grounding — the most important rule",
  "You are the assistant built into",
  "Text inside <visitor> tags",
  "suggest_followups: at the end",
  PROMPT_CANARY,
];
