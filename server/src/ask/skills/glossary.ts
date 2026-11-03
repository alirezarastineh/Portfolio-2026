import { z } from "zod";

import type { Locale } from "../../content/schema.js";
import {
  bare,
  generalDefinitions,
  glossaryLines,
  inLanguage,
  noFigures,
  termsFrom,
  visible,
} from "./gates.js";
import { defineSkill, LANGUAGE } from "./skill.js";
import { CASE_STUDY_READ } from "./summary.js";

export const glossaryInput = z.object({
  task: z.literal("glossary"),
  /** The case study's text, its fields' HTML included (the editor's `pageText`). */
  text: z.string().min(1).max(250_000),
  locale: z.enum(["en", "de"]),
});

type GlossaryInput = z.infer<typeof glossaryInput>;

interface GlossaryPrepared {
  locale: Locale;
  /** What a reader sees of the case study: where each term must be found. */
  source: string;
}

const MAX_TERMS = 8;
const DEFINITION_WORDS = 30;

/**
 * A case study's "Terms used here" (plan 3, W7): its own technical words, each
 * defined in general, as the lines the editor's glossary field holds
 * (`parseGlossary`). The owner reviews before anything is saved.
 */
export const glossary = defineSkill<GlossaryInput, GlossaryPrepared>({
  id: "glossary",
  description:
    "Lists up to 8 technical terms of a case study, each as the case study writes it, with a general definition of at most 30 words in its language: no figures, nothing about Alireza or his work.",
  whenToUse: "A case study whose readers may not know its terms: the Suggest beside its glossary.",
  input: glossaryInput,
  models: "text",
  prepare: (input) => ({ locale: input.locale, source: visible(input.text) }),
  build: (prepared) => ({
    instructions: `List the technical terms in this case study from a senior AI / full-stack engineer's portfolio that a reader who is not an engineer may not know: at most ${MAX_TERMS}, each written exactly as the case study writes it. Define each in ${LANGUAGE[prepared.locale]} in at most ${DEFINITION_WORDS} words, in general: what the term means anywhere, not how this project uses it. No figures, nothing about the author or his work. One term a line, as "term: definition". Return only the lines.`,
    prompt: prepared.source.slice(0, CASE_STUDY_READ),
  }),
  gates: [
    glossaryLines(MAX_TERMS, DEFINITION_WORDS),
    termsFrom((prepared) => prepared.source),
    noFigures(),
    generalDefinitions(),
    bare(),
    inLanguage((prepared) => prepared.locale),
  ],
  samples: [{ locale: "en", source: "Atlas ranks passages with embeddings in pgvector." }],
});
