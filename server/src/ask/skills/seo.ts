import { z } from "zod";

import { atLeast, bare, inLanguage, visible, withinLength } from "./gates.js";
import { defineSkill, LANGUAGE } from "./skill.js";

export const seoInput = z.object({
  task: z.literal("seo"),
  text: z.string().min(1).max(20_000),
  locale: z.enum(["en", "de"]),
  maxLength: z.number().int().min(50).max(320).default(155),
});

type SeoInput = z.infer<typeof seoInput>;

export const seo = defineSkill<SeoInput>({
  id: "seo",
  description:
    "Drafts a page's search-result description from the page's own text: specific, factual, within the length search results show.",
  whenToUse:
    "A project or post whose search description is empty or stale: the Suggest beside the field.",
  input: seoInput,
  models: "text",
  build: (input) => ({
    instructions: `Write a search-result description in ${LANGUAGE[input.locale]} for this page of a senior AI / full-stack engineer's portfolio: specific, factual, no hype, at most ${input.maxLength} characters. Return only the description.`,
    prompt: input.text.replace(/<[^<>]{1,1000}>/g, " ").slice(0, 8_000),
  }),
  gates: [
    withinLength((input) => input.maxLength),
    // Half the cap, at most 50: a shorter description says too little.
    atLeast((input) => Math.min(50, Math.floor(input.maxLength / 2)), "min(50, cap / 2)"),
    bare(),
    inLanguage((input) => input.locale),
  ],
  explore: {
    subject: "a search-result description of the page",
    evidence: (input) => visible(input.text).slice(0, 8_000),
    leads: [
      { id: "outcome", instruction: "Lead with what the work achieved: its outcome or result." },
      { id: "problem", instruction: "Lead with the problem it solves, and for whom." },
      { id: "stack", instruction: "Lead with how it was built: its key technology or approach." },
    ],
  },
  samples: [
    {
      task: "seo",
      text: "<h2>Atlas</h2><p>A retrieval system over 2 M documents, built with pgvector.</p>",
      locale: "en",
      maxLength: 155,
    },
  ],
});
