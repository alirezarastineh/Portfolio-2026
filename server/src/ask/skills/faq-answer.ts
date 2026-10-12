import { z } from "zod";

import type { Locale } from "../../content/schema.js";
import type { AskCorpus } from "../corpus/index.js";
import { answerShape, cited, grounded, inLanguage, NO_ANSWER, withoutMarkers } from "./gates.js";
import { defineSkill, LANGUAGE } from "./skill.js";

export { NO_ANSWER } from "./gates.js";

export const faqAnswerInput = z.object({
  task: z.literal("faq-answer"),
  question: z.string().min(3).max(300),
  locale: z.enum(["en", "de"]),
});

type FaqAnswerInput = z.infer<typeof faqAnswerInput>;

interface FaqAnswerPrepared {
  question: string;
  locale: Locale;
  /** The core an answer in that language reads (corpus/render.ts). */
  core: string;
  /** The published documents the answer's citations must name (the gates read them). */
  corpus: Pick<AskCorpus, "byId">;
}

/** At most this many words, the citations aside. */
const MAX_WORDS = 80;

export const faqAnswer = defineSkill<FaqAnswerInput, FaqAnswerPrepared>({
  id: "faq-answer",
  description:
    "Drafts an FAQ answer from the published portfolio only, in at most 80 words, or says the portfolio does not answer it.",
  whenToUse:
    "A question visitors ask (often from the insights) that needs an FAQ entry: the FAQ form's Draft an answer.",
  input: faqAnswerInput,
  models: "text",
  prepare: async (input, ctx) => {
    const corpus = await ctx.corpus();
    return {
      question: input.question,
      locale: input.locale,
      core: corpus.core[input.locale],
      corpus,
    };
  },
  // The citations let the gates check each fact against its document; the admin
  // gets the answer without them (`finish`).
  build: (prepared) => ({
    instructions: `Draft an answer in ${LANGUAGE[prepared.locale]} to a question visitors ask about Alireza Rastineh, using only the portfolio documents below. Third person, at most ${MAX_WORDS} words. Cite each fact with its document's id in brackets, as [^id], the id from the document's header. If the documents do not answer it, write exactly: ${NO_ANSWER}\n\n# Portfolio documents\n\n${prepared.core}`,
    prompt: prepared.question,
  }),
  abstains: (text) => text === NO_ANSWER,
  gates: [
    answerShape(MAX_WORDS),
    cited((prepared) => prepared),
    grounded((prepared) => prepared),
    inLanguage((prepared) => prepared.locale),
  ],
  finish: (text) => (text.trim() === NO_ANSWER ? NO_ANSWER : withoutMarkers(text)),
  // The live corpus is data, not the skill: the sample holds a placeholder core.
  samples: [
    {
      question: "Is he open to relocating?",
      locale: "en",
      core: "(the core an answer in this language reads)",
      corpus: { byId: new Map() },
    },
  ],
});
