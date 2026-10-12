import { z } from "zod";

import {
  inLanguage,
  lengthRatio,
  sameCode,
  sameLinks,
  sameNumbers,
  sameTags,
  visible,
  withinLength,
} from "./gates.js";
import { defineSkill, LANGUAGE, SkillAnswer, type SkillDefinition } from "./skill.js";

export const translateInput = z.object({
  task: z.literal("translate"),
  text: z.string().min(1).max(20_000),
  from: z.enum(["en", "de"]),
  to: z.enum(["en", "de"]),
  /** Rich-text fields send HTML; the markup must come back unchanged. */
  html: z.boolean().default(false),
  /** The field's own limit, when it has one: a gate, never a cut (plan phase 28). */
  maxLength: z.number().int().min(10).max(20_000).optional(),
  /** False skips the critic; by default it reads a translation of 30 words or more. */
  critic: z.boolean().optional(),
  /** The portfolio's names and terms, kept as they are (plan phase 29: the content agent sends them). */
  glossary: z.array(z.string().trim().min(1).max(60)).max(80).optional(),
});

type TranslateInput = z.infer<typeof translateInput>;

/** A source this long (in words) is worth a second model's reading. */
export const CRITIC_FROM_WORDS = 30;

const source = (input: TranslateInput) => input.text;

/** The definition, apart from the registered skill: its version is pinned in skills.spec. */
export const translateSkill: SkillDefinition<TranslateInput, TranslateInput> = {
  id: "translate",
  description:
    "Translates a field between English and German, keeping technical terms, product names, numbers, code and any HTML markup as they are.",
  whenToUse:
    "A field written in one language and missing or behind in the other: a field's translate → DE or → EN.",
  input: translateInput,
  models: "text",
  prepare: (input) =>
    input.from === input.to ? new SkillAnswer({ text: input.text }, 200) : input,
  build: (input) => {
    const format = input.html
      ? "The text is HTML: keep every tag and attribute exactly as it is and translate only the text between tags."
      : "Return plain text.";
    const glossary = input.glossary?.length
      ? ` Keep these names and terms exactly as they are: ${input.glossary.join(", ")}.`
      : "";
    return {
      instructions: `Translate the text from ${LANGUAGE[input.from]} to ${LANGUAGE[input.to]} for a senior engineer's portfolio. Keep technical terms, product names, numbers and code unchanged; keep the tone. ${format}${glossary} Return only the translation.`,
      prompt: input.text,
    };
  },
  gates: [
    sameTags(source),
    sameNumbers(source),
    sameLinks(source),
    sameCode(source),
    inLanguage((input) => input.to),
    lengthRatio(source, 0.6, 1.6),
    withinLength((input) => input.maxLength),
  ],
  critic: (input) =>
    input.critic === false ||
    visible(input.text).split(" ").filter(Boolean).length < CRITIC_FROM_WORDS
      ? null
      : {
          instructions: `You check a translation from ${LANGUAGE[input.from]} to ${LANGUAGE[input.to]} for a senior engineer's portfolio against its source. Look for meaning lost, changed or added; technical terms, product names or code translated that should have stayed; a tone unlike the source's. List each real problem in one sentence that says what to change; leave out matters of taste. When there is none, answer ok with no problems.`,
          source: input.text,
        },
  samples: [
    {
      task: "translate",
      text: "<p>Shipped the <strong>search</strong> pipeline.</p>",
      from: "en",
      to: "de",
      html: true,
    },
    { task: "translate", text: "Hat die Suche gebaut.", from: "de", to: "en", html: false },
    {
      task: "translate",
      text: "Atlas sucht mit pgvector.",
      from: "de",
      to: "en",
      html: false,
      glossary: ["Atlas", "pgvector"],
    },
    {
      task: "translate",
      text: "Built a retrieval system over two million documents with pgvector, cut support escalations by 38 % in a year, and moved the team from weekly releases to shipping several times a day.",
      from: "en",
      to: "de",
      html: false,
    },
  ],
};

export const translate = defineSkill(translateSkill);
