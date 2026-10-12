import { z } from "zod";

import { bare, inLanguage, sameNumbers, shorter, withinLength } from "./gates.js";
import { defineSkill, LANGUAGE } from "./skill.js";

export const tightenInput = z.object({
  task: z.literal("tighten"),
  text: z.string().min(1).max(2_000),
  locale: z.enum(["en", "de"]),
  maxLength: z.number().int().min(10).max(2_000).optional(),
});

type TightenInput = z.infer<typeof tightenInput>;

const source = (input: TightenInput) => input.text;

export const tighten = defineSkill<TightenInput>({
  id: "tighten",
  description:
    "Rewrites a field shorter and sharper in its own language, keeping every fact, within the field's length limit when it has one.",
  whenToUse: "A field that says the right thing at too many words: a field's tighten.",
  input: tightenInput,
  models: "text",
  build: (input) => {
    const limit = input.maxLength ? `At most ${input.maxLength} characters. ` : "";
    return {
      instructions: `Rewrite the text in ${LANGUAGE[input.locale]} to be shorter and sharper, keeping every fact. ${limit}No quotes, no preamble. Return only the rewritten text.`,
      prompt: input.text,
    };
  },
  gates: [
    withinLength((input) => input.maxLength),
    shorter(source),
    sameNumbers(source),
    bare(),
    inLanguage((input) => input.locale),
  ],
  // Any field, from a hero line to an availability note: leads that suit every one.
  explore: {
    subject: "a tightened version of the text",
    evidence: source,
    leads: [
      { id: "order", instruction: "Keep the order of the ideas: cut words, never facts." },
      { id: "strongest", instruction: "Open with the strongest, most specific point." },
      { id: "shortest", instruction: "Make it as short as its facts allow." },
    ],
  },
  samples: [
    {
      task: "tighten",
      text: "I am an engineer who has been building search systems for a number of years now.",
      locale: "en",
      maxLength: 60,
    },
    { task: "tighten", text: "Ich baue seit einigen Jahren Suchsysteme.", locale: "de" },
  ],
});
