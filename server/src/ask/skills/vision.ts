import type { ModelMessage } from "ai";

import type { Locale } from "../../content/schema.js";
import { SkillAnswer, type SkillContext } from "./skill.js";

/** An uploaded image as alt and describe send it, with the language to write in. */
export interface Picture {
  image: Uint8Array;
  mediaType: string;
  name: string;
  locale: Locale;
}

/** The image the copilot looks at (alt-image.ts), or the same not-found / not-an-image refusal. */
export async function loadPicture(
  input: { mediaId: string; locale: Locale },
  ctx: SkillContext,
): Promise<Picture | SkillAnswer> {
  const picture = await ctx.image(input.mediaId);
  if (!picture.ok) {
    return new SkillAnswer({ error: picture.error }, picture.error === "not_found" ? 404 : 400);
  }
  return {
    image: picture.image,
    mediaType: picture.mediaType,
    name: picture.name,
    locale: input.locale,
  };
}

export function picturePrompt(picture: Picture): ModelMessage[] {
  return [
    {
      role: "user",
      content: [
        { type: "file", data: picture.image, mediaType: picture.mediaType },
        { type: "text", text: `The file is called "${picture.name}".` },
      ],
    },
  ];
}

/** A stand-in picture for the version's samples: the bytes are not the skill. */
export const SAMPLE_PICTURE = {
  image: new Uint8Array([137, 80, 78, 71]),
  mediaType: "image/png",
  name: "diagram.png",
} as const;
