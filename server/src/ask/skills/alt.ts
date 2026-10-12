import { z } from "zod";

import { bare, inLanguage, noImageOf, withinLength } from "./gates.js";
import { defineSkill, LANGUAGE } from "./skill.js";
import { loadPicture, type Picture, picturePrompt, SAMPLE_PICTURE } from "./vision.js";

export const altInput = z.object({
  task: z.literal("alt"),
  mediaId: z.uuid(),
  locale: z.enum(["en", "de"]),
});

type AltInput = z.infer<typeof altInput>;

/** Alt text a screen reader reads in one breath; the field itself takes 300. */
const ALT_MAX = 150;

export const alt = defineSkill<AltInput, Picture>({
  id: "alt",
  description:
    "Writes an image's alt text from the picture itself: what a reader who cannot see it needs, in one sentence.",
  whenToUse:
    "An uploaded image without alt text in a language: the media library's Suggest alt text.",
  input: altInput,
  models: "vision",
  prepare: loadPicture,
  build: (picture) => ({
    instructions: `Write the alt text in ${LANGUAGE[picture.locale]} for this image on a senior AI / full-stack engineer's portfolio: what it shows that a reader who cannot see it needs, in one sentence of at most ${ALT_MAX} characters. Name the product, diagram or screen if it is clear; no "image of", no quotes, no guessing at text you cannot read. Return only the alt text.`,
    prompt: picturePrompt(picture),
  }),
  gates: [
    withinLength(() => ALT_MAX),
    noImageOf(),
    bare(),
    inLanguage((picture) => picture.locale),
  ],
  samples: [{ ...SAMPLE_PICTURE, locale: "en" }],
});
