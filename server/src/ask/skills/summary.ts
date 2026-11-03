import { z } from "zod";

import type { Locale } from "../../content/schema.js";
import { bare, figuresFrom, inLanguage, plainWords, visible, withinWords } from "./gates.js";
import { defineSkill, LANGUAGE } from "./skill.js";

export const summaryInput = z.object({
  task: z.literal("summary"),
  /** The case study's text, its fields' HTML included (the editor's `pageText`). */
  text: z.string().min(1).max(250_000),
  locale: z.enum(["en", "de"]),
  level: z.enum(["plain", "expert"]),
});

type SummaryInput = z.infer<typeof summaryInput>;

interface SummaryPrepared {
  level: SummaryInput["level"];
  locale: Locale;
  /** What a reader sees of the case study: what the draft's figures must come from. */
  source: string;
}

/** At most this many words: "In short" reads at a glance. */
const MAX_WORDS = 80;
/** The prompt reads this much of the case study, more than any of today's holds. */
export const CASE_STUDY_READ = 40_000;

const READER = {
  plain:
    "a reader who is not an engineer: everyday words, short sentences, each technical term explained or left out",
  expert:
    "an engineer: the problem, the approach and its trade-offs, and the outcome, in the case study's own terms",
} as const;

/**
 * A case study's "In short" (plan 3, W7): one summary a call, plain for any
 * reader or for an engineer (the field below it, folded on the page). Its
 * figures come from the case study alone; the owner's review is the gate on
 * names and employers (a capital-letter test fails German).
 */
export const summary = defineSkill<SummaryInput, SummaryPrepared>({
  id: "summary",
  description:
    "Summarizes a case study in at most 80 words, in its own language: in plain words for any reader, or for an engineer; every figure one the case study states.",
  whenToUse:
    "A case study without its “In short”: the Suggest beside its plain summary or its summary for experts.",
  input: summaryInput,
  models: "text",
  prepare: (input) => ({ level: input.level, locale: input.locale, source: visible(input.text) }),
  build: (prepared) => ({
    instructions: `Summarize this case study from a senior AI / full-stack engineer's portfolio in ${LANGUAGE[prepared.locale]}, for ${READER[prepared.level]}. At most ${MAX_WORDS} words, in the case study's own voice. Use only what it says: every figure must be one it states. Return only the summary.`,
    prompt: prepared.source.slice(0, CASE_STUDY_READ),
  }),
  gates: [
    withinWords(MAX_WORDS),
    figuresFrom((prepared) => prepared.source),
    plainWords((prepared) => (prepared.level === "plain" ? prepared.locale : null)),
    bare(),
    inLanguage((prepared) => prepared.locale),
  ],
  samples: [
    {
      level: "plain",
      locale: "en",
      source: "Atlas A retrieval system over 2 M documents, built with pgvector.",
    },
    {
      level: "expert",
      locale: "de",
      source: "Atlas Ein Retrieval-System über 2 Mio. Dokumente, mit pgvector gebaut.",
    },
  ],
});
