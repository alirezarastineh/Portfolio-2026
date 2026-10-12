import { z } from "zod";

import { bare, inLanguage, withinLength } from "./gates.js";
import { defineSkill, LANGUAGE } from "./skill.js";
import { loadPicture, type Picture, picturePrompt, SAMPLE_PICTURE } from "./vision.js";

export const describeInput = z.object({
  task: z.literal("describe"),
  mediaId: z.uuid(),
  locale: z.enum(["en", "de"]),
});

type DescribeInput = z.infer<typeof describeInput>;

/** An image description for the assistant (plan phase 17); the field takes 2,000. */
const DESCRIBE_MAX = 1_200;

export const describe = defineSkill<DescribeInput, Picture>({
  id: "describe",
  description:
    "Describes a diagram or screenshot for the assistant, which cannot see it: a diagram's parts and each connection, a screenshot's facts and numbers.",
  whenToUse:
    "An image a published page shows whose content the assistant should be able to answer from: the media library's Describe.",
  input: describeInput,
  models: "vision",
  prepare: loadPicture,
  // A diagram needs its relations spelled out: the representation that keeps
  // what the questions need (plan phase 17, multi-modal fusion).
  build: (picture) => ({
    instructions: `Describe this image from a senior AI / full-stack engineer's portfolio for an assistant that answers questions about it but cannot see it. Write in ${LANGUAGE[picture.locale]}, plain text, at most ${DESCRIBE_MAX} characters. A diagram: name its parts, then each connection on its own line as "A → B: what passes between them". A screenshot or a chart: what it is, and the facts and numbers it shows. Only what you can see or read; never guess at a label or a number you cannot read. Return only the description.`,
    prompt: picturePrompt(picture),
  }),
  gates: [withinLength(() => DESCRIBE_MAX), bare(), inLanguage((picture) => picture.locale)],
  samples: [{ ...SAMPLE_PICTURE, locale: "en" }],
});
